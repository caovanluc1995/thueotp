import { redirect } from 'next/navigation';

export default function Home() {
  // Tự động chuyển thẳng người dùng từ trang chủ sang trang /login
  redirect('/login');
}