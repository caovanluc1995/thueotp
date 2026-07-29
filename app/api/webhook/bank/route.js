import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Hàm xác thực chữ ký Webhook từ payOS
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

    // 1. KHIỂM TRA CHỮ KÝ BẢO MẬT PAYOS (Chống hack giả mạo)
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY;
    if (checksumKey) {
      const isValid = verifyPayOSSignature(body, checksumKey);
      if (!isValid) {
        console.error('CẢNH BÁO: Phát hiện Request Webhook giả mạo!');
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

    // Trích xuất mã NAP từ nội dung chuyển khoản
    const match = memo.match(/NAP\s+([A-Z0-9]+)/);
    if (!match) {
      return NextResponse.json({ success: true, message: "Không đúng cú pháp NAP" });
    }

    const userIdentifier = match[1].trim();

    // 2. CHỐNG CỘNG TRÙNG GIAO DỊCH (Idempotency)
    const { data: existingTx } = await supabaseAdmin
      .from('transactions')
      .select('id')
      .eq('reference_id', transactionId)
      .maybeSingle();

    if (existingTx) {
      return NextResponse.json({ success: true, message: "Giao dịch đã xử lý" });
    }

    // 3. TÌM TÀI KHOẢN KHÁCH HÀNG
    const { data: profiles } = await supabaseAdmin.from('profiles').select('id, email');
    const targetUser = profiles?.find((p) => {
      const prefixEmail = p.email ? p.email.split('@')[0].toUpperCase() : '';
      const prefixId = p.id ? p.id.substring(0, 6).toUpperCase() : '';
      return prefixEmail === userIdentifier || prefixId === userIdentifier;
    });

    if (!targetUser) {
      return NextResponse.json({ success: true, message: "Không tìm thấy user tương ứng" });
    }

    // 4. LƯU GIAO DỊCH TRƯỚC VÀ CỘNG TIỀN ATOMIC (Chống race condition)
    const { error: txErr } = await supabaseAdmin.from('transactions').insert([{
      user_id: targetUser.id,
      amount: amount,
      type: 'DEPOSIT',
      reference_id: transactionId,
      description: `Nạp tiền tự động (+${amount.toLocaleString()}đ) - CK: ${memo}`
    }]);

    if (!txErr) {
      // Gọi RPC hoặc cập nhật an toàn
      await supabaseAdmin.rpc('increment_balance', { 
        user_id_input: targetUser.id, 
        amount_input: amount 
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Lỗi xử lý Webhook:', err);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}