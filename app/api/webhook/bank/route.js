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

    const checksumKey = process.env.PAYOS_CHECKSUM_KEY;
    if (!checksumKey) {
      console.error('CẤU HÌNH THIẾU: PAYOS_CHECKSUM_KEY chưa được set trên server!');
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    // 1. Xác thực chữ ký Webhook
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

    // 2. Bắt cú pháp NAP
    const match = memo.match(/NAP\s+([A-Z0-9]+)/);
    if (!match) {
      console.log('Nội dung chuyển khoản không khớp cú pháp NAP:', memo);
      await supabaseAdmin.from('unmatched_deposits').insert([{
        reference_id: transactionId,
        amount,
        memo,
        raw_payload: body,
      }]).select().maybeSingle();
      return NextResponse.json({ success: true, message: "Không đúng cú pháp NAP" });
    }

    const userCode = match[1].trim();

    // 3. Tìm chính xác User thông qua DB Query trực tiếp (Tránh kéo全 bộ profiles về RAM)
    // Giả định User ID dạng UUID, kiểm tra chính xác 8 ký tự đầu trực tiếp trong Postgres SQL
    const { data: matchedUsers, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('id', `${userCode}%`)
      .limit(1);

    const targetUser = matchedUsers && matchedUsers.length > 0 ? matchedUsers[0] : null;

    if (!targetUser) {
      console.error(`Không tìm thấy user với mã: ${userCode}`);
      await supabaseAdmin.from('unmatched_deposits').insert([{
        reference_id: transactionId,
        amount,
        memo,
        raw_payload: body,
      }]);
      return NextResponse.json({ success: true, message: "User không tồn tại - đã lưu để đối chiếu" });
    }

    // 4. Ghi log giao dịch - Bắt buộc dùng Unique Key reference_id để chống nạp trùng
    const { error: insertErr } = await supabaseAdmin.from('transactions').insert([{
      user_id: targetUser.id,
      amount: amount,
      type: 'DEPOSIT',
      reference_id: transactionId,
      description: `Nạp tiền tự động payOS (+${amount.toLocaleString()}đ)`
    }]);

    if (insertErr) {
      if (insertErr.code === '23505') { // Postgres code 23505: Unique constraint violation
        return NextResponse.json({ success: true, message: "Giao dịch đã được xử lý từ trước" });
      }
      console.error('Lỗi khi ghi log giao dịch:', insertErr);
      return NextResponse.json({ error: 'Failed to log transaction' }, { status: 500 });
    }

    // 5. Cộng số dư tài khoản
    const { error: updateErr } = await supabaseAdmin.rpc('increment_balance', {
      p_user_id: targetUser.id,
      p_amount: amount,
    });

    if (updateErr) {
      console.error('Lỗi khi cập nhật số dư:', updateErr);
      return NextResponse.json({ error: 'Failed to update balance' }, { status: 500 });
    }

    console.log(`Đã cộng thành công ${amount}đ cho user: ${targetUser.id}`);
    return NextResponse.json({ success: true });

  } catch (err) {
    console.error('Lỗi hệ thống Webhook:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}