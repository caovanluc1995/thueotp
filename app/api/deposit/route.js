import { NextResponse } from 'next/server';
import { PayOS } from '@payos/node';

export async function POST(request) {
  try {
    // 1. Lấy biến môi trường
    const clientId = process.env.PAYOS_CLIENT_ID;
    const apiKey = process.env.PAYOS_API_KEY;
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY;

    if (!clientId || !apiKey || !checksumKey) {
      return NextResponse.json(
        { error: 'Thiếu cấu hình PAYOS (CLIENT_ID, API_KEY, CHECKSUM_KEY) trên Vercel!' },
        { status: 500 }
      );
    }

    // 2. Khởi tạo SDK payOS chuẩn (Dạng Object)
    const payos = new PayOS({
      clientId: clientId,
      apiKey: apiKey,
      checksumKey: checksumKey,
    });

    // 3. Lấy dữ liệu từ client
    const body = await request.json();
    const { amount, userId, userEmail } = body;

    if (!amount || Number(amount) < 10000) {
      return NextResponse.json({ error: 'Số tiền nạp tối thiểu là 10.000đ' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'Thiếu thông tin tài khoản người dùng' }, { status: 400 });
    }

    // 4. Lấy domain động
    const host = request.headers.get('host') || 'thueotp7.vercel.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const origin = `${protocol}://${host}`;

    // 5. Chuẩn hóa chuỗi mô tả (Dưới 25 ký tự, không chứa ký tự đặc biệt)
    const rawIdentifier = userEmail ? userEmail.split('@')[0] : userId;
    const cleanIdentifier = rawIdentifier.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase();
    const description = `NAP ${cleanIdentifier}`.substring(0, 25);

    // Tạo mã đơn hàng dạng số
    const orderCode = Number(String(Date.now()).slice(-6) + Math.floor(100 + Math.random() * 900));

    // 6. Tạo dữ liệu thanh toán
    const paymentData = {
      orderCode: orderCode,
      amount: Number(amount),
      description: description,
      cancelUrl: `${origin}/dashboard`,
      returnUrl: `${origin}/dashboard`,
    };

    // 7. Gọi API payOS tạo link / QR
    const paymentLinkRes = await payos.createPaymentLink(paymentData);

    return NextResponse.json({
      ok: true,
      checkoutUrl: paymentLinkRes.checkoutUrl,
      qrCode: paymentLinkRes.qrCode,
    });

  } catch (error) {
    console.error('Lỗi khi tạo payment link payOS:', error);
    return NextResponse.json(
      { error: error?.message || 'Không thể tạo mã thanh toán, vui lòng thử lại!' },
      { status: 500 }
    );
  }
}