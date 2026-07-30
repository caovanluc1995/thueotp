'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { Mail, Lock, ArrowRight, Phone, ShieldCheck, Loader2 } from 'lucide-react';

const translateError = (message) => {
  if (!message) return '';
  const msg = message.toLowerCase();

  if (msg.includes('password should be at least') || msg.includes('character')) {
    return 'Mật khẩu phải có từ 8 - 64 ký tự, bao gồm cả chữ cái và chữ số.';
  }
  if (msg.includes('user already registered') || msg.includes('already exists')) {
    return 'Email này đã được đăng ký. Vui lòng chuyển sang Đăng nhập!';
  }
  if (msg.includes('invalid login credentials')) {
    return 'Email hoặc mật khẩu không chính xác.';
  }
  if (msg.includes('email not confirmed')) {
    return 'Email chưa được xác nhận. Vui lòng kiểm tra lại hộp thư.';
  }
  if (msg.includes('invalid email')) {
    return 'Địa chỉ email không đúng định dạng.';
  }
  if (msg.includes('rate limit')) {
    return 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.';
  }

  return 'Đã có lỗi xảy ra. Vui lòng kiểm tra lại thông tin!';
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const router = useRouter();

  const validateInput = () => {
    // 1. Kiểm tra độ dài Email
    if (email.length > 100) {
      setMessage({ type: 'error', text: 'Email quá dài (Tối đa 100 ký tự).' });
      return false;
    }

    // 2. Kiểm tra định dạng Email chuẩn
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      setMessage({ type: 'error', text: 'Địa chỉ email không hợp lệ.' });
      return false;
    }

    // 3. Kiểm tra Mật khẩu khi Đăng ký
    if (isSignUp) {
      if (password.length < 8 || password.length > 64) {
        setMessage({ type: 'error', text: 'Mật khẩu phải từ 8 đến 64 ký tự.' });
        return false;
      }
      
      // Kiểm tra mật khẩu bắt buộc phải có ít nhất 1 chữ cái và 1 chữ số
      const hasLetter = /[a-zA-Z]/.test(password);
      const hasNumber = /[0-9]/.test(password);
      if (!hasLetter || !hasNumber) {
        setMessage({ type: 'error', text: 'Mật khẩu phải chứa ít nhất 1 chữ cái và 1 chữ số.' });
        return false;
      }
    }

    return true;
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setMessage(null);

    // Validate dữ liệu trước khi gửi lên Supabase
    if (!validateInput()) return;

    setLoading(true);

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({ 
        email: email.trim(), 
        password 
      });
      
      if (error) {
        setMessage({ type: 'error', text: translateError(error.message) });
      } else {
        if (data?.user) {
          await supabase.from('profiles').insert([
            { id: data.user.id, email: data.user.email, balance: 0 }
          ]);
        }
        setMessage({ type: 'success', text: 'Đăng ký thành công! Bạn có thể đăng nhập ngay.' });
        setIsSignUp(false);
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ 
        email: email.trim(), 
        password 
      });
      if (error) {
        setMessage({ type: 'error', text: translateError(error.message) });
      } else {
        router.push('/dashboard');
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-purple-950 to-slate-900 p-4">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md relative">
          <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-8 rounded-2xl shadow-2xl space-y-6">
            
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-violet-600 shadow-lg shadow-blue-500/30 mb-2">
                <Phone className="w-7 h-7 text-white" />
              </div>
              <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-300 to-indigo-400">
                THUÊ OTP 247
              </h1>
              <p className="text-sm text-slate-400">
                {isSignUp ? 'Tạo tài khoản mới để bắt đầu sử dụng' : 'Hệ thống cung cấp số điện thoại nhận OTP tự động'}
              </p>
            </div>

            {message && (
              <div
                className={`p-3.5 rounded-xl text-sm font-medium flex items-center gap-2.5 ${
                  message.type === 'error'
                    ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                    : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                }`}
              >
                <ShieldCheck className="w-5 h-5 shrink-0" />
                <span>{message.text}</span>
              </div>
            )}

            <form onSubmit={handleAuth} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    type="email"
                    required
                    maxLength={100}
                    placeholder="name@example.com"
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3 pl-11 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 text-sm"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Mật khẩu
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    maxLength={64}
                    placeholder="••••••••"
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3 pl-11 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 text-sm"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white font-medium py-3 rounded-xl shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Đang xác thực...</span>
                  </>
                ) : (
                  <>
                    <span>{isSignUp ? 'Đăng Ký Tài Khoản' : 'Đăng Nhập'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="pt-2 text-center border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setMessage(null);
                }}
                className="text-sm text-slate-400 hover:text-blue-400 transition font-medium"
              >
                {isSignUp ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký ngay'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <footer className="py-4 text-center text-xs text-slate-500 border-t border-slate-800/50">
        <p>© 2026 THUÊ OTP 247</p>
      </footer>
    </div>
  );
}