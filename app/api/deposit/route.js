import { NextResponse } from 'next/server';
import PayOS from '@payos/node';

const payos = new PayOS(
  process.env.PAYOS_CLIENT_ID,
  process.env.PAYOS_API_KEY,
  process.env.PAYOS_CHECKSUM_KEY
);

export async function POST(request) {
  try {
    const { amount, userId, userEmail } = await request.json();

    if (!amount || amount < 10000) {
      return NextResponse.json({ error: 'Số tiền nạp tối thiểu là 10.000đ' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'Thiếu thông tin tài khoản' }, { status: 400 });
    }

    // Lấy prefix Email hoặc 6 ký tự ID
    const userIdentifier = userEmail ? userEmail.split('@')[0].toUpperCase() : userId.substring(0, 6).toUpperCase();

    // Tạo orderCode ngẫu nhiên dạng số integer (An toàn tuyệt đối với payOS)
    const orderCode = Math.floor(100000 + Math.random() * 900000);

    // Cấu hình đơn hàng payOS
    const paymentData = {
      orderCode: orderCode,
      amount: Number(amount),
      description: `NAP ${userIdentifier}`,
      cancelUrl: 'https://thueotp1.vercel.app',
      returnUrl: 'https://thueotp1.vercel.app',
    };

    const paymentLinkRes = await payos.createPaymentLink(paymentData);

    return NextResponse.json({
      ok: true,
      checkoutUrl: paymentLinkRes.checkoutUrl,
      qrCode: paymentLinkRes.qrCode,
    });
  } catch (error) {
    console.error('Lỗi tạo thanh toán payOS:', error);
    return NextResponse.json({ error: 'Không thể tạo mã thanh toán, vui lòng thử lại!' }, { status: 500 });
  }
}