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

async function getAuthenticatedUser(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;

  return data.user;
}

export async function POST(request) {
  try {
    if (!OTIS_KEY) {
      return NextResponse.json({ error: 'Chưa cấu hình API Key dịch vụ' }, { status: 500 });
    }

    const authUser = await getAuthenticatedUser(request);
    if (!authUser) {
      return NextResponse.json({ error: 'Vui lòng đăng nhập lại' }, { status: 401 });
    }
    const userId = authUser.id;

    const body = await request.json();
    const { action, serviceCode, carrier, sessionId } = body;

    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': OTIS_KEY,
    };

    // 1. THUÊ SỐ MỚI
    if (action === 'START') {
      if (!serviceCode || !(serviceCode in SERVICE_PRICES)) {
        return NextResponse.json({ error: 'Dịch vụ không hợp lệ' }, { status: 400 });
      }

      const price = SERVICE_PRICES[serviceCode];
      const realOtisServiceCode = SERVICE_MAP[serviceCode];

      let newBalance;
      try {
        const { data, error } = await supabaseAdmin.rpc('rent_deduct_balance', {
          p_user_id: userId,
          p_amount: price,
        });
        if (error) throw error;
        newBalance = data;
      } catch (err) {
        if (String(err.message || '').includes('INSUFFICIENT_BALANCE')) {
          return NextResponse.json({ error: 'Số dư tài khoản không đủ!' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Lỗi hệ thống, vui lòng thử lại' }, { status: 500 });
      }

      let otisRes;
      try {
        otisRes = await axios.post(
          `${OTIS_URL}/api/phone-rental/start`,
          { service: realOtisServiceCode, carrier: carrier || 'random' },
          { headers, timeout: 10000 }
        );
      } catch (err) {
        await supabaseAdmin.rpc('increment_balance', { p_user_id: userId, p_amount: price });
        return NextResponse.json({ error: 'Hệ thống hết số hoặc đang bảo trì, thử lại sau!' }, { status: 400 });
      }

      const { sessionId: otisSessionId, phoneNumber } = otisRes.data || {};
      if (!otisSessionId || !phoneNumber) {
        await supabaseAdmin.rpc('increment_balance', { p_user_id: userId, p_amount: price });
        return NextResponse.json({ error: 'Không thể lấy số từ nhà mạng lúc này' }, { status: 400 });
      }

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

    // 2. NHẬN OTP VÀ HOÀN TIỀN
    if (action === 'GET_OTP') {
      if (!sessionId) {
        return NextResponse.json({ error: 'Thiếu thông tin tra cứu' }, { status: 400 });
      }

      try {
        const response = await axios.get(
          `${OTIS_URL}/api/phone-rental/get-otp?sessionId=${encodeURIComponent(sessionId)}`,
          { headers, timeout: 8000 }
        );

        const data = response.data;

        if (data.status === 'expired' || data.status === 'error') {
          // Gọi RPC an toàn chống race condition
          const { data: refundResult, error: refundErr } = await supabaseAdmin.rpc(
            'process_order_refund',
            { p_session_id: sessionId, p_user_id: userId }
          );

          if (!refundErr && refundResult && refundResult[0]?.refunded) {
            const refundedAmount = refundResult[0].refund_amount;
            await supabaseAdmin.from('transactions').insert([{
              user_id: userId,
              amount: refundedAmount,
              type: 'REFUND',
              description: `Hoàn tiền đơn thuê hết hạn (${sessionId})`
            }]);
          }
        }

        return NextResponse.json(data);
      } catch (err) {
        return NextResponse.json({ status: 'waiting' });
      }
    }

    return NextResponse.json({ error: 'Hành động không hợp lệ' }, { status: 400 });
  } catch (error) {
    console.error('Lỗi hệ thống:', error);
    return NextResponse.json({ error: 'Lỗi hệ thống máy chủ' }, { status: 500 });
  }
}