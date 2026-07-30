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

// Xác thực người gọi bằng access token thay vì tin userId do client tự gửi lên.
// Client (dashboard) cần gửi header: Authorization: Bearer <access_token>
// (access_token lấy từ supabase.auth.getSession() ở phía client).
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

    // 0. Bắt buộc xác thực trước khi làm bất cứ điều gì
    const authUser = await getAuthenticatedUser(request);
    if (!authUser) {
      return NextResponse.json({ error: 'Vui lòng đăng nhập lại' }, { status: 401 });
    }
    const userId = authUser.id; // KHÔNG dùng userId từ body nữa

    const body = await request.json();
    const { action, serviceCode, carrier, sessionId } = body;

    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': OTIS_KEY,
    };

    // 1. THUÊ SỐ MỚI
    if (action === 'START') {
      if (!serviceCode) {
        return NextResponse.json({ error: 'Thiếu thông tin yêu cầu' }, { status: 400 });
      }

      // Whitelist chặt: không cho serviceCode lạ lọt qua với giá mặc định
      if (!(serviceCode in SERVICE_PRICES)) {
        return NextResponse.json({ error: 'Dịch vụ không hợp lệ' }, { status: 400 });
      }

      const price = SERVICE_PRICES[serviceCode];
      const realOtisServiceCode = SERVICE_MAP[serviceCode];

      // Trừ tiền NGUYÊN TỬ qua RPC — DB tự kiểm tra đủ số dư,
      // tránh race condition khi bấm 2 lần / 2 request đồng thời.
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
        console.error('Lỗi trừ tiền:', err);
        return NextResponse.json({ error: 'Lỗi hệ thống, vui lòng thử lại' }, { status: 500 });
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
        // Hoàn tiền ngay vì chưa lấy được số
        await supabaseAdmin.rpc('increment_balance', { p_user_id: userId, p_amount: price });
        return NextResponse.json({
          error: 'Hệ thống hết số hoặc đang bảo trì, thử lại sau!'
        }, { status: 400 });
      }

      const { sessionId: otisSessionId, phoneNumber } = otisRes.data || {};
      if (!otisSessionId || !phoneNumber) {
        // Hoàn tiền vì không lấy được số hợp lệ
        await supabaseAdmin.rpc('increment_balance', { p_user_id: userId, p_amount: price });
        return NextResponse.json({ error: 'Không thể lấy số từ nhà mạng lúc này' }, { status: 400 });
      }

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
      if (!sessionId) {
        return NextResponse.json({ error: 'Thiếu thông tin tra cứu' }, { status: 400 });
      }

      try {
        const response = await axios.get(
          `${OTIS_URL}/api/phone-rental/get-otp?sessionId=${encodeURIComponent(sessionId)}`,
          { headers }
        );

        const data = response.data;

        if (data.status === 'expired' || data.status === 'error') {
          // Khóa đơn bằng update có điều kiện — CHỈ đơn của chính user này mới được xử lý.
          // (trước đây thiếu .eq('user_id', userId) nên ai biết sessionId cũng hoàn được tiền
          //  về ví của chính họ thay vì chủ đơn thật)
          const { data: updatedOrders } = await supabaseAdmin
            .from('orders')
            .update({ status: 'EXPIRED' })
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .eq('status', 'PENDING')
            .select();

          if (updatedOrders && updatedOrders.length > 0) {
            const order = updatedOrders[0];
            const refundAmount = Number(order.price);

            const { data: refundedBalance, error: refundErr } = await supabaseAdmin.rpc(
              'increment_balance',
              { p_user_id: userId, p_amount: refundAmount }
            );

            if (!refundErr) {
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
    console.error('Lỗi hệ thống:', error);
    return NextResponse.json({ error: 'Lỗi hệ thống máy chủ' }, { status: 500 });
  }
}