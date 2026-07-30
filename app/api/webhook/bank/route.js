import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function verifyPayOSSignature(webhookData, checksumKey) {
  if (!webhookData || !webhookData.signature) return false;

  const { signature, data } = webhookData;
  const sortedKeys = Object.keys(data).sort();
  const signData = sortedKeys
    .map((key) => `${key}=${data[key] === null || data[key] === undefined ? '' : data[key]}`)
    .join('&');

  const computedSignature = crypto
    .createHmac('sha256', checksumKey)
    .update(signData)
    .digest('hex');

  return computedSignature === signature;
}

export async function POST(request) {
  try {
    const body = await request.json();

    // 1. Kiểm tra chữ ký bảo mật Webhook từ PayOS
    // FAIL-CLOSED: nếu thiếu checksumKey trên server thì từ chối luôn,
    // KHÔNG được âm thầm bỏ qua bước xác minh chữ ký như bản cũ.
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY;
    if (!checksumKey) {
      console.error('CẤU HÌNH THIẾU: PAYOS_CHECKSUM_KEY chưa được set trên server!');
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const isValid = verifyPayOSSignature(body, checksumKey);
    if (!isValid) {
      console.error('CẢNH BÁO: Request Webhook không hợp lệ!');
      return NextResponse.json({ error: 'Invalid Signature' }, { status: 400 });
    }

    const data = body.data;
    if (!data) {
      return NextResponse.json({ success: true, message: "Webhook ping test" });
    }

    const memo = (data.description || '').toUpperCase();
    const amount = Number(data.amount || 0);
    const transactionId = String(data.reference || data.orderCode);

    if (amount <= 0) return NextResponse.json({ success: true });

    // Trích xuất mã NAP (Ví dụ: NAP 8A1B2C3D)
    const match = memo.match(/NAP\s+([A-Z0-9]+)/);
    if (!match) {
      console.log('Nội dung chuyển khoản không khớp cú pháp NAP:', memo);
      return NextResponse.json({ success: true, message: "Không đúng cú pháp NAP" });
    }

    const userCode = match[1].trim();

    // 2. Tìm User tương ứng trong Supabase
    const { data: profiles, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('id, balance');

    if (profileErr || !profiles) {
      console.error('Lỗi truy vấn bảng profiles:', profileErr);
      return NextResponse.json({ error: 'Database Error' }, { status: 500 });
    }

    const targetUser = profiles.find((p) => {
      const cleanId = String(p.id).replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
      return cleanId === userCode;
    });

    if (!targetUser) {
      console.error(`Không tìm thấy user với mã: ${userCode}`);
      return NextResponse.json({ success: true, message: "User không tồn tại" });
    }

    // 3. Ghi log giao dịch TRƯỚC, dựa vào unique constraint của DB trên reference_id
    // để chống trùng (an toàn hơn select-rồi-insert vì không có khoảng hở giữa 2 bước).
    // -> Nhớ chạy migration.sql để tạo unique index cho transactions.reference_id trước.
    const { error: insertErr } = await supabaseAdmin.from('transactions').insert([{
      user_id: targetUser.id,
      amount: amount,
      type: 'DEPOSIT',
      reference_id: transactionId,
      description: `Nạp tiền tự động payOS (+${amount.toLocaleString()}đ)`
    }]);

    if (insertErr) {
      // Vi phạm unique constraint => giao dịch này đã được xử lý trước đó, bỏ qua an toàn
      if (insertErr.code === '23505') {
        return NextResponse.json({ success: true, message: "Giao dịch đã được xử lý từ trước" });
      }
      console.error('Lỗi khi ghi log giao dịch:', insertErr);
      return NextResponse.json({ error: 'Failed to log transaction' }, { status: 500 });
    }

    // 4. Cộng tiền NGUYÊN TỬ qua RPC (tránh lost-update khi có webhook trùng thời điểm)
    const { error: updateErr } = await supabaseAdmin.rpc('increment_balance', {
      p_user_id: targetUser.id,
      p_amount: amount,
    });

    if (updateErr) {
      console.error('Lỗi khi cập nhật số dư:', updateErr);
      // Giao dịch đã được ghi log nhưng cộng tiền lỗi — cần xử lý thủ công / có cảnh báo riêng
      return NextResponse.json({ error: 'Failed to update balance' }, { status: 500 });
    }

    console.log(`Đã cộng thành công ${amount}đ cho user: ${targetUser.id}`);
    return NextResponse.json({ success: true });

  } catch (err) {
    console.error('Lỗi hệ thống Webhook:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}