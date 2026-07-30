import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function createPaymentSignature(data, checksumKey) {
  const sortedDataKeys = Object.keys(data).sort();
  const dataQueryStr = sortedDataKeys
    .map((key) => `${key}=${data[key] === null || data[key] === undefined ? '' : data[key]}`)
    .join('&');

  return crypto
    .createHmac('sha256', checksumKey)
    .update(dataQueryStr)
    .digest('hex');
}

export async function POST(request) {
  try {
    const clientId = process.env.PAYOS_CLIENT_ID;
    const apiKey = process.env.PAYOS_API_KEY;
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY;

    if (!clientId || !apiKey || !checksumKey) {
      return NextResponse.json(
        { error: 'Thiếu cấu hình PAYOS trên Vercel!' },
        { status: 500 }
      );
    }

    // Bắt buộc kiểm tra Authorization Header
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ error: 'Vui lòng đăng nhập' }, { status: 401 });
    }

    const { data: userData, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !userData?.user) {
      return NextResponse.json({ error: 'Phiên đăng nhập không hợp lệ' }, { status: 401 });
    }

    const userId = userData.user.id;
    const body = await request.json();
    const { amount } = body;

    if (!amount || Number(amount) < 10000 || Number(amount) > 100000000) {
      return NextResponse.json({ error: 'Số tiền nạp không hợp lệ (Từ 10.000đ đến 100.000.000đ)' }, { status: 400 });
    }

    const host = request.headers.get('host') || 'thueotp7.vercel.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const origin = `${protocol}://${host}`;

    const cleanUserId = String(userId).replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
    const description = `NAP ${cleanUserId}`;
    
    const orderCode = Number(Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 899 + 100));

    const paymentData = {
      amount: Number(amount),
      cancelUrl: `${origin}/dashboard`,
      description: description,
      orderCode: orderCode,
      returnUrl: `${origin}/dashboard`,
    };

    const signature = createPaymentSignature(paymentData, checksumKey);

    const payosResponse = await fetch('https://api-merchant.payos.vn/v2/payment-requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId,
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        ...paymentData,
        signature: signature,
      }),
    });

    const resData = await payosResponse.json();

    if (resData.code !== '00') {
      console.error('Lỗi từ PayOS API:', resData);
      return NextResponse.json(
        { error: resData.desc || 'Không thể tạo mã thanh toán từ PayOS!' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      checkoutUrl: resData.data.checkoutUrl,
      qrCode: resData.data.qrCode,
      accountNo: resData.data.accountNo,
      accountName: resData.data.accountName,
      bin: resData.data.bin,
      description: description,
      amount: amount
    });

  } catch (error) {
    console.error('Lỗi Server:', error);
    return NextResponse.json(
      { error: error?.message || 'Lỗi kết nối máy chủ!' },
      { status: 500 }
    );
  }
}