import { NextResponse } from 'next/server';
import crypto from 'crypto';

function createPaymentSignature(data, checksumKey) {
  const sortedDataKeys = Object.keys(data).sort();
  const dataQueryStr = sortedDataKeys
    .map((key) => `${key}=${data[key]}`)
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

    const body = await request.json();
    const { amount, userId, userEmail } = body;

    if (!amount || Number(amount) < 10000) {
      return NextResponse.json({ error: 'Số tiền nạp tối thiểu là 10.000đ' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'Thiếu thông tin tài khoản' }, { status: 400 });
    }

    const host = request.headers.get('host') || 'thueotp7.vercel.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const origin = `${protocol}://${host}`;

    // Lấy 8 ký tự đầu của User ID (viết hoa, xóa ký tự đặc biệt) làm mã nạp cố định
    const cleanUserId = String(userId).replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
    
    // Nội dung chuyển khoản chuẩn: NAP <8_KY_TU_USER_ID>
    const description = `NAP ${cleanUserId}`;
    const orderCode = Number(String(Date.now()).slice(-6) + Math.floor(100 + Math.random() * 900));

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