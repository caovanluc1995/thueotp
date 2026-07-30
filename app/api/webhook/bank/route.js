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

    const match = memo.match(/NAP\s+([A-Z0-9]+)/);
    if (!match) {
      console.log('Nội dung chuyển khoản không khớp cú pháp NAP:', memo);
      // Vẫn ghi lại để không mất dấu vết, admin có thể đối chiếu tay
      await supabaseAdmin.from('unmatched_deposits').insert([{
        reference_id: transactionId,
        amount,
        memo,
        raw_payload: body,
      }]).select().maybeSingle();
      return NextResponse.json({ success: true, message: "Không đúng cú pháp NAP" });
    }

    const userCode = match[1].trim();

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
      // QUAN TRỌNG: không được im lặng bỏ qua — ghi lại để admin đối chiếu và cộng tay,
      // vì trả success:true khiến PayOS coi là đã xử lý xong và KHÔNG gửi lại webhook nữa.
      const { error: logErr } = await supabaseAdmin.from('unmatched_deposits').insert([{
        reference_id: transactionId,
        amount,
        memo,
        raw_payload: body,
      }]);
      if (logErr) console.error('Lỗi khi ghi log unmatched_deposits:', logErr);

      return NextResponse.json({ success: true, message: "User không tồn tại - đã lưu để đối chiếu" });
    }

    const { error: insertErr } = await supabaseAdmin.from('transactions').insert([{
      user_id: targetUser.id,
      amount: amount,
      type: 'DEPOSIT',
      reference_id: transactionId,
      description: `Nạp tiền tự động payOS (+${amount.toLocaleString()}đ)`
    }]);

    if (insertErr) {
      if (insertErr.code === '23505') {
        return NextResponse.json({ success: true, message: "Giao dịch đã được xử lý từ trước" });
      }
      console.error('Lỗi khi ghi log giao dịch:', insertErr);
      return NextResponse.json({ error: 'Failed to log transaction' }, { status: 500 });
    }

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