import { NextResponse } from 'next/server';
import { PayOS } from '@payos/node';

export async function POST(request) {
  try {
    // 1. Kiểm tra các biến môi trường từ Vercel
    const clientId = process.env.PAYOS_CLIENT_ID;
    const apiKey = process.env.PAYOS_API_KEY;
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY;

    if (!clientId || !apiKey || !checksumKey) {
      console.error('LỖI: Thiếu biến môi trường PAYOS trên Vercel!');
      return NextResponse.json(
        { error: 'Chưa cấu hình đủ Environment Variables trên Vercel!' },
        { status: 500 }
      );
    }

    // 2. Khởi tạo SDK payOS
    const payos = new PayOS(clientId, apiKey, checksumKey);

    // 3. Lấy dữ liệu từ Frontend
    const body = await request.json();
    const { amount, userId, userEmail } = body;

    // Validate dữ liệu đầu vào
    if (!amount || Number(amount) < 10000) {
      return NextResponse.json({ error: 'Số tiền nạp tối thiểu là 10.000đ' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'Thiếu thông tin tài khoản người dùng' }, { status: 400 });
    }

    // 4. Tự động lấy Domain hiện tại
    const host = request.headers.get('host') || 'thueotp5.vercel.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const origin = `${protocol}://${host}`;

    // 5. Làm sạch và tạo nội dung chuyển khoản (ĐÃ FIX LỖI REGEX)
    const rawIdentifier = userEmail ? userEmail.split('@')[0] : userId;
    const cleanIdentifier = rawIdentifier.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase();
    const description = `NAP ${cleanIdentifier}`.substring(0, 25);

    // Tạo orderCode ngẫu nhiên dạng số nguyên unique
    const orderCode = Number(String(Date.now()).slice(-6) + Math.floor(100 + Math.random() * 900));

    // 6. Cấu hình dữ liệu thanh toán
    const paymentData = {
      orderCode: orderCode,
      amount: Number(amount),
      description: description,
      cancelUrl: `${origin}/dashboard`,
      returnUrl: `${origin}/dashboard`,
    };

    // 7. Gọi payOS tạo link thanh toán
    const paymentLinkRes = await payos.createPaymentLink(paymentData);

    return NextResponse.json({
      ok: true,
      checkoutUrl: paymentLinkRes.checkoutUrl,
      qrCode: paymentLinkRes.qrCode,
    });

  } catch (error) {
    console.error('Lỗi API deposit:', error);
    return NextResponse.json(
      { error: error?.message || 'Không thể tạo mã thanh toán, vui lòng kiểm tra lại cấu hình payOS!' },
      { status: 500 }
    );
  }
}