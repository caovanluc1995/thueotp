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

    // 1. Kiểm tra cú pháp NAP <MA_USER>
    const match = memo.match(/NAP\s+([A-Z0-9]+)/);
    if (!match) {
      console.log('Nội dung chuyển khoản không khớp cú pháp NAP:', memo);
      await supabaseAdmin.from('unmatched_deposits').insert([{
        reference_id: transactionId,
        amount,
        memo,
        raw_payload: body,
      }]);
      return NextResponse.json({ success: true, message: "Không đúng cú pháp NAP" });
    }

    const userCode = match[1].trim();

    // 2. Tìm User bằng hàm RPC get_user_by_short_id (Nhanh và không tải toàn bộ DB)
    const { data: targetUserList, error: findErr } = await supabaseAdmin
      .rpc('get_user_by_short_id', { p_short_id: userCode });

    if (findErr) {
      console.error('Lỗi khi gọi RPC get_user_by_short_id:', findErr);
      return NextResponse.json({ error: 'Database Error' }, { status: 500 });
    }

    // Nếu không tìm thấy User tương ứng với mã
    if (!targetUserList || targetUserList.length === 0) {
      console.error(`Không tìm thấy user với mã: ${userCode}`);
      await supabaseAdmin.from('unmatched_deposits').insert([{
        reference_id: transactionId,
        amount,
        memo,
        raw_payload: body,
      }]);
      return NextResponse.json({ success: true, message: "User không tồn tại - đã lưu để đối chiếu" });
    }

    const targetUser = targetUserList[0];

    // 3. Xử lý nạp tiền Atomic bằng hàm RPC process_payos_deposit (Chống nạp trùng / Race Condition)
    const { data: processResult, error: processErr } = await supabaseAdmin.rpc('process_payos_deposit', {
      p_user_id: targetUser.id,
      p_amount: amount,
      p_reference_id: transactionId,
      p_description: `Nạp tiền tự động payOS (+${amount.toLocaleString()}đ)`
    });

    if (processErr) {
      console.error('Lỗi khi gọi RPC process_payos_deposit:', processErr);
      return NextResponse.json({ error: 'Failed to process deposit' }, { status: 500 });
    }

    // Nếu giao dịch này đã từng xử lý trước đó
    if (processResult?.already_processed) {
      return NextResponse.json({ success: true, message: "Giao dịch đã được xử lý từ trước" });
    }

    console.log(`Đã cộng thành công ${amount}đ cho user: ${targetUser.id}`);
    return NextResponse.json({ success: true });

  } catch (err) {
    console.error('Lỗi hệ thống Webhook:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}