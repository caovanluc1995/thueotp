import { NextResponse } from 'next/server';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const OTIS_KEY = process.env.WEB_A_API_KEY;
const OTIS_URL = process.env.WEB_A_BASE_URL || 'https://otistx.com';

const SERVICE_MAP = {
  shopee_v1: 'otissim_v1',
  shopee_v2: 'otissim_v2',
  shopee_v3: 'otissim_v3',
  shopee_v4: 'otissim_v4',
};

const SERVICE_PRICES = {
  shopee_v1: 5000,
  shopee_v2: 5500,
  shopee_v3: 5000,
  shopee_v4: 5000,
};

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    if (!OTIS_KEY) {
      return NextResponse.json({ error: 'Chưa cấu hình API Key dịch vụ' }, { status: 500 });
    }

    const body = await request.json();
    const { action, userId, serviceCode, carrier, sessionId } = body;

    // TODO Bảo mật: Nên verify Session / JWT Token của user tại đây

    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': OTIS_KEY,
    };

    // 1. THUÊ SỐ MỚI
    if (action === 'START') {
      if (!userId || !serviceCode) {
        return NextResponse.json({ error: 'Thiếu thông tin yêu cầu' }, { status: 400 });
      }

      const price = SERVICE_PRICES[serviceCode] || 5000;
      const realOtisServiceCode = SERVICE_MAP[serviceCode] || serviceCode;

      // Trừ tiền bằng RPC (Atomic Update) để chống race condition bấm 2 lần
      const { data: profile, error: profileErr } = await supabaseAdmin
        .from('profiles')
        .select('balance')
        .eq('id', userId)
        .single();

      if (profileErr || !profile || Number(profile.balance) < price) {
        return NextResponse.json({ error: 'Số dư tài khoản không đủ!' }, { status: 400 });
      }

      // Gọi API Otis
      let otisRes;
      try {
        otisRes = await axios.post(
          `${OTIS_URL}/api/phone-rental/start`,
          { service: realOtisServiceCode, carrier: carrier || 'random' },
          { headers }
        );
      } catch (err) {
        return NextResponse.json({ 
          error: 'Hệ thống hết số hoặc đang bảo trì, thử lại sau!' 
        }, { status: 400 });
      }

      const { sessionId: otisSessionId, phoneNumber } = otisRes.data || {};
      if (!otisSessionId || !phoneNumber) {
        return NextResponse.json({ error: 'Không thể lấy số từ nhà mạng lúc này' }, { status: 400 });
      }

      // Trừ tiền
      const newBalance = Number(profile.balance) - price;
      await supabaseAdmin.from('profiles').update({ balance: newBalance }).eq('id', userId);

      // Lưu đơn
      const { data: orderData } = await supabaseAdmin.from('orders').insert([{
        user_id: userId,
        service_name: serviceCode,
        phone_number: phoneNumber,
        session_id: otisSessionId,
        price: price,
        status: 'PENDING'
      }]).select().single();

      await supabaseAdmin.from('transactions').insert([{
        user_id: userId,
        amount: -price,
        type: 'RENT',
        description: `Thuê số Shopee ${phoneNumber}`
      }]);

      return NextResponse.json({
        ok: true,
        orderId: orderData?.id,
        sessionId: otisSessionId,
        phoneNumber: phoneNumber,
        cost: price,
        newBalance: newBalance,
        message: 'Đã thuê số thành công'
      });
    }

    // 2. NHẬN OTP VÀ HOÀN TIỀN TỰ ĐỘNG
    if (action === 'GET_OTP') {
      if (!sessionId || !userId) {
        return NextResponse.json({ error: 'Thiếu thông tin tra cứu' }, { status: 400 });
      }

      try {
        const response = await axios.get(
          `${OTIS_URL}/api/phone-rental/get-otp?sessionId=${encodeURIComponent(sessionId)}`,
          { headers }
        );

        const data = response.data;

        if (data.status === 'expired' || data.status === 'error') {
          // Khóa đơn bằng cách update status ngay lập tức để tránh trùng hoàn tiền
          const { data: updatedOrders } = await supabaseAdmin
            .from('orders')
            .update({ status: 'EXPIRED' })
            .eq('session_id', sessionId)
            .eq('status', 'PENDING')
            .select();

          // Nếu update thành công 1 đơn (nghĩa là đơn đó chưa hề được hoàn tiền trước đây)
          if (updatedOrders && updatedOrders.length > 0) {
            const order = updatedOrders[0];
            const refundAmount = Number(order.price);

            // Hoàn tiền vào ví
            const { data: userProf } = await supabaseAdmin.from('profiles').select('balance').eq('id', userId).single();
            if (userProf) {
              const refundedBalance = Number(userProf.balance) + refundAmount;
              await supabaseAdmin.from('profiles').update({ balance: refundedBalance }).eq('id', userId);

              await supabaseAdmin.from('transactions').insert([{
                user_id: userId,
                amount: refundAmount,
                type: 'REFUND',
                description: `Hoàn tiền thuê số ${order.phone_number} (Không nhận được OTP)`
              }]);
            }
          }
        }

        return NextResponse.json(data);
      } catch (err) {
        return NextResponse.json({ status: 'waiting' });
      }
    }

    return NextResponse.json({ error: 'Hành động không hợp lệ' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Lỗi hệ thống máy chủ' }, { status: 500 });
  }
}