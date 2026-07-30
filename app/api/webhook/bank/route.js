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
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY;
    if (checksumKey) {
      const isValid = verifyPayOSSignature(body, checksumKey);
      if (!isValid) {
        console.error('CẢNH BÁO: Request Webhook không hợp lệ!');
        return NextResponse.json({ error: 'Invalid Signature' }, { status: 400 });
      }
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

    // 2. Chống cộng tiền trùng lặp
    const { data: existingTx } = await supabaseAdmin
      .from('transactions')
      .select('id')
      .eq('reference_id', transactionId)
      .maybeSingle();

    if (existingTx) {
      return NextResponse.json({ success: true, message: "Giao dịch đã được xử lý từ trước" });
    }

    // 3. Tìm User tương ứng trong Supabase
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

    // 4. Lưu giao dịch & cộng tiền vào ví
    const currentBalance = Number(targetUser.balance || 0);
    const newBalance = currentBalance + amount;

    // Cập nhật số dư User
    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({ balance: newBalance })
      .eq('id', targetUser.id);

    if (updateErr) {
      console.error('Lỗi khi cập nhật số dư:', updateErr);
      return NextResponse.json({ error: 'Failed to update balance' }, { status: 500 });
    }

    // Ghi log giao dịch
    await supabaseAdmin.from('transactions').insert([{
      user_id: targetUser.id,
      amount: amount,
      type: 'DEPOSIT',
      reference_id: transactionId,
      description: `Nạp tiền tự động payOS (+${amount.toLocaleString()}đ)`
    }]);

    console.log(`Đã cộng thành công ${amount}đ cho user: ${targetUser.id}`);
    return NextResponse.json({ success: true });

  } catch (err) {
    console.error('Lỗi hệ thống Webhook:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}