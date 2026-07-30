"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import {
  Phone,
  Wallet,
  History,
  LogOut,
  User,
  ShoppingBag,
  RefreshCw,
  Clock,
  QrCode,
  ShieldAlert,
  AlertCircle,
  ArrowRight,
  ExternalLink,
  CheckCircle2, 
  ShieldCheck, 
  Send, 
  MessageCircle, 
  MessageSquare,
  KeyRound,
  Lock,
  X
} from "lucide-react";

const SHOPEE_SERVICES = [
  {
    id: "shopee_v1",
    name: "Phiên bản sim V1",
    price: 5000,
    desc: "Trả số trực tiếp, không check số chưa đăng ký shopee",
  },
  {
    id: "shopee_v2",
    name: "Phiên bản sim V2",
    price: 5500,
    desc: "Có check trạng thái số",
  },
  {
    id: "shopee_v3",
    name: "Phiên bản sim V3",
    price: 5000,
    desc: "Có check trạng thái số",
  },
  {
    id: "shopee_v4",
    name: "Phiên bản sim V4",
    price: 5000,
    desc: "Có check trạng thái số",
  },
];

const CARRIER_OPTIONS = {
  shopee_v1: [
    { id: "viettel", name: "Viettel" },
    { id: "mobifone", name: "Mobifone" },
    { id: "vinaphone", name: "Vinaphone" },
    { id: "vnmb", name: "Vietnammobile" },
    { id: "random", name: "Ngẫu nhiên (Random)" },
  ],
  shopee_v4: [{ id: "vnmb", name: "Vietnammobile" }],
  shopee_v3: [
    { id: "main_3", name: "3 mạng chính (Viettel, Mobifone, Vinaphone)" },
    { id: "vnmb", name: "Vietnammobile" },
    { id: "random", name: "Ngẫu nhiên (Random)" },
  ],
  shopee_default: [
    { id: "viettel", name: "Viettel" },
    { id: "mobifone", name: "Mobifone" },
    { id: "vinaphone", name: "Vinaphone" },
    { id: "vnmb", name: "Vietnammobile" },
    { id: "random", name: "Ngẫu nhiên (Random)" },
  ],
};

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  const [selectedService, setSelectedService] = useState(SHOPEE_SERVICES[2]); // V3 default
  const [selectedCarrier, setSelectedCarrier] = useState("random");

  const [activeOrder, setActiveOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [depositLoading, setDepositLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("rent");
  const [errorMsg, setErrorMsg] = useState(null);

  const [depositAmount, setDepositAmount] = useState(20000);
  const [depositError, setDepositError] = useState(null);
  const [depositSuccessMsg, setDepositSuccessMsg] = useState(false);

  // State User Dropdown Menu & Change Password Modal
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePassLoading, setChangePassLoading] = useState(false);
  const [modalMsg, setModalMsg] = useState(null);

  // Thông tin thanh toán payOS
  const [payosData, setPayosData] = useState(null);
  const [transactions, setTransactions] = useState([]);

  const previousBalanceRef = useRef(0);
  const menuRef = useRef(null);
  const router = useRouter();

  const getAvailableCarriers = () => {
    if (selectedService.id === "shopee_v1") return CARRIER_OPTIONS.shopee_v1;
    if (selectedService.id === "shopee_v4") return CARRIER_OPTIONS.shopee_v4;
    if (selectedService.id === "shopee_v3") return CARRIER_OPTIONS.shopee_v3;
    return CARRIER_OPTIONS.shopee_default;
  };

  useEffect(() => {
    const carriers = getAvailableCarriers();
    if (
      carriers.length > 0 &&
      !carriers.some((c) => c.id === selectedCarrier)
    ) {
      setSelectedCarrier(carriers[0].id);
    }
  }, [selectedService]);

  // Click outside to close user dropdown menu
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleDepositChange = (val) => {
    const MAX_AMOUNT = 100000000;
    let num = Math.max(0, Number(val));
    if (num > MAX_AMOUNT) {
      num = MAX_AMOUNT;
    }

    setDepositAmount(num);
    setPayosData(null);
    setDepositSuccessMsg(false);

    if (num < 10000) {
      setDepositError("Số tiền nạp tối thiểu là 10.000 VNĐ");
    } else {
      setDepositError(null);
    }
  };

  const handleGenerateQR = async () => {
    const num = Number(depositAmount);
    if (num < 10000) {
      setDepositError("Số tiền nạp tối thiểu là 10.000 VNĐ");
      setPayosData(null);
      return;
    }

    const currentUserId = profile?.id || user?.id;
    const currentUserEmail = profile?.email || user?.email;

    if (!currentUserId) {
      setDepositError(
        "Đang tải thông tin tài khoản, vui lòng bấm thử lại sau 2 giây!",
      );
      return;
    }

    setDepositError(null);
    setDepositSuccessMsg(false);
    setDepositLoading(true);

    try {
      const res = await fetch("/api/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: num,
          userId: currentUserId,
          userEmail: currentUserEmail,
        }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        setPayosData(data);
      } else {
        setDepositError(
          data.error || "Không thể tạo mã thanh toán, thử lại sau!",
        );
      }
    } catch (err) {
      setDepositError("Lỗi kết nối máy chủ tạo hóa đơn thanh toán!");
    }
    setDepositLoading(false);
  };

  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return router.push("/login");
      setUser(user);
      fetchProfile(user.id);
      fetchHistory(user.id);
    };
    fetchUser();
  }, [router]);

  useEffect(() => {
    if (!user || activeTab !== "deposit") return;

    const timer = setInterval(() => {
      fetchProfile(user.id);
      fetchHistory(user.id);
    }, 3000);

    return () => clearInterval(timer);
  }, [user, activeTab, payosData]);

  const fetchProfile = async (userId) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (data) {
      const newBalance = Number(data.balance || 0);

      if (payosData && newBalance > previousBalanceRef.current) {
        setPayosData(null);
        setDepositSuccessMsg(true);
      }

      previousBalanceRef.current = newBalance;
      setProfile(data);
    } else {
      setProfile({ id: userId, email: user?.email, balance: 0 });
    }
  };

  const fetchHistory = async (userId) => {
    const { data } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (data) setTransactions(data);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  // Hàm Xử Lý Đổi Mật Khẩu qua Supabase Auth
  const handleChangePassword = async (e) => {
    e.preventDefault();
    setModalMsg(null);

    if (newPassword.length < 8 || newPassword.length > 64) {
      setModalMsg({ type: "error", text: "Mật khẩu phải từ 8 - 64 ký tự." });
      return;
    }

    const hasLetter = /[a-zA-Z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    if (!hasLetter || !hasNumber) {
      setModalMsg({ type: "error", text: "Mật khẩu phải chứa ít nhất 1 chữ cái và 1 chữ số." });
      return;
    }

    if (newPassword !== confirmPassword) {
      setModalMsg({ type: "error", text: "Mật khẩu xác nhận không khớp." });
      return;
    }

    setChangePassLoading(true);

    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    setChangePassLoading(false);

    if (error) {
      setModalMsg({ type: "error", text: "Lỗi đổi mật khẩu: " + error.message });
    } else {
      setModalMsg({ type: "success", text: "Đổi mật khẩu thành công!" });
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        setShowChangePasswordModal(false);
        setModalMsg(null);
      }, 1500);
    }
  };

  const handleRentNumber = async () => {
    setErrorMsg(null);
    const cost = selectedService.price;

    if (!profile || Number(profile.balance || 0) < cost) {
      return setErrorMsg("Số dư tài khoản không đủ, vui lòng nạp thêm tiền!");
    }

    setLoading(true);
    try {
      const res = await fetch("/api/rent-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "START",
          userId: user.id,
          serviceCode: selectedService.id,
          carrier: selectedCarrier,
        }),
      });

      const data = await res.json();

      if (res.ok && data.sessionId && data.phoneNumber) {
        setActiveOrder({
          id: data.orderId,
          sessionId: data.sessionId,
          phoneNumber: data.phoneNumber,
          serviceName: selectedService.name,
          status: "waiting",
          otp: null,
          message: data.message,
        });

        setProfile({ ...profile, balance: data.newBalance });
        fetchHistory(user.id);
      } else {
        setErrorMsg(
          data.error || "Không thể lấy số lúc này, vui lòng thử lại sau!",
        );
      }
    } catch (err) {
      setErrorMsg("Lỗi kết nối tới hệ thống máy chủ!");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (
      !activeOrder ||
      activeOrder.status === "completed" ||
      activeOrder.status === "expired" ||
      activeOrder.status === "error"
    ) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/rent-number", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "GET_OTP",
            userId: user.id,
            sessionId: activeOrder.sessionId,
          }),
        });

        const data = await res.json();

        if (res.ok && data.status) {
          if (data.status === "completed" && data.otp) {
            setActiveOrder((prev) => ({
              ...prev,
              otp: data.otp,
              status: "completed",
              message: "Đã nhận mã OTP thành công!",
            }));
            fetchProfile(user.id);
            fetchHistory(user.id);
            clearInterval(interval);
          } else if (data.status === "expired" || data.status === "error") {
            setActiveOrder((prev) => ({
              ...prev,
              status: data.status,
              message: "Đơn thuê đã hết hạn. Tiền đã được hoàn lại tự động!",
            }));
            fetchProfile(user.id);
            fetchHistory(user.id);
            clearInterval(interval);
          }
        }
      } catch (e) {
        console.error("Polling OTP Error:", e);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [activeOrder, user]);

  if (!profile) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-300">
        <RefreshCw className="w-8 h-8 animate-spin text-orange-500 mr-3" />
        <span>Đang tải thông tin hệ thống...</span>
      </div>
    );
  }

  const currentCarriers = getAvailableCarriers();
  const username = profile.email ? profile.email.split("@")[0] : "Người dùng";

  const getQrImageUrl = () => {
    if (!payosData) return "";

    if (payosData.qrCode && payosData.qrCode.startsWith("http")) {
      return payosData.qrCode;
    }

    if (payosData.bin && payosData.accountNo) {
      const bankBin = payosData.bin;
      const accountNo = payosData.accountNo;
      const amount = payosData.amount || depositAmount;
      const addInfo = encodeURIComponent(payosData.description || "");
      return `https://img.vietqr.io/image/${bankBin}-${accountNo}-compact2.png?amount=${amount}&addInfo=${addInfo}`;
    }

    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
      payosData.qrCode || payosData.checkoutUrl,
    )}`;
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-purple-950 to-slate-900 text-slate-100 p-4 md:p-8 flex flex-col justify-between">
      <div className="max-w-5xl mx-auto space-y-6 w-full">
        
        {/* HEADER VỚI USER MENU MỚI */}
        <header className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-5 rounded-2xl flex flex-col md:flex-row justify-between items-center gap-4 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Phone className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black bg-gradient-to-r from-orange-400 via-amber-300 to-yellow-400 bg-clip-text text-transparent">
                THUÊ OTP SHOPEE 247
              </h1>
              <p className="text-xs text-slate-400 flex items-center gap-1">
                Hệ thống nhận OTP tự động 24/7
              </p>
            </div>
          </div>

          {/* SỐ DƯ VÀ DROPDOWN TÀI KHOẢN */}
          <div className="flex items-center gap-3 w-full md:w-auto justify-end">
            {/* Khung Số dư */}
            <div className="bg-emerald-500 text-white px-3.5 py-1.5 rounded-xl flex items-center gap-2 shadow-sm">
              <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm">
                $
              </div>
              <div className="text-left leading-tight">
                <span className="block text-[10px] opacity-80 uppercase font-semibold">Số dư</span>
                <span className="font-bold text-sm">{Number(profile.balance || 0).toLocaleString()} đ</span>
              </div>
            </div>

            {/* User Dropdown Menu Button */}
            <div className="relative inline-block text-left" ref={menuRef}>
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="flex items-center gap-2.5 p-1.5 pr-3 rounded-xl hover:bg-slate-800/60 transition cursor-pointer border border-transparent hover:border-slate-800"
              >
                <div className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center text-white shadow-md">
                  <User className="w-5 h-5" />
                </div>
                <span className="font-medium text-slate-100 text-sm hidden sm:inline-block">
                  {username}
                </span>
              </button>

              {/* Menu Thả Xuống (Dropdown) */}
              {isMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-4 py-3 border-b border-slate-800/80">
                    <p className="font-semibold text-slate-100 text-base truncate">{username}</p>
                    <p className="text-xs text-slate-400 truncate mt-0.5">{profile.email}</p>
                    <span className="inline-block mt-2 px-2.5 py-0.5 text-[11px] font-medium text-slate-300 bg-slate-800 rounded-md">
                      Người dùng
                    </span>
                  </div>

                  <div className="py-1">
                    <button
                      onClick={() => {
                        setIsMenuOpen(false);
                        setShowChangePasswordModal(true);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-slate-800/60 transition text-left"
                    >
                      <KeyRound className="w-4 h-4 text-slate-400" />
                      <span>Đổi mật khẩu</span>
                    </button>

                    <button
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition text-left"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Đăng xuất</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <nav className="flex gap-2 p-1.5 bg-slate-900/60 border border-slate-800/80 rounded-2xl">
          <button
            onClick={() => setActiveTab("rent")}
            className={`flex-1 py-3 px-4 rounded-xl font-medium text-sm transition flex items-center justify-center gap-2 ${
              activeTab === "rent"
                ? "bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <ShoppingBag className="w-4 h-4" /> Thuê Số OTP Shopee
          </button>
          <button
            onClick={() => setActiveTab("deposit")}
            className={`flex-1 py-3 px-4 rounded-xl font-medium text-sm transition flex items-center justify-center gap-2 ${
              activeTab === "deposit"
                ? "bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <Wallet className="w-4 h-4" /> Nạp Tiền (payOS Tự Động)
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`flex-1 py-3 px-4 rounded-xl font-medium text-sm transition flex items-center justify-center gap-2 ${
              activeTab === "history"
                ? "bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <History className="w-4 h-4" /> Lịch Sử
          </button>
        </nav>

        {activeTab === "rent" && (
          <div className="space-y-6">
            <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-6 rounded-2xl shadow-xl space-y-6">
              {errorMsg && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl flex items-center gap-2 text-sm font-medium">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  1. Chọn gói sim OTP Shopee:
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {SHOPEE_SERVICES.map((s) => {
                    const isSelected = selectedService.id === s.id;
                    return (
                      <div
                        key={s.id}
                        onClick={() => setSelectedService(s)}
                        className={`p-4 rounded-xl border cursor-pointer transition relative ${
                          isSelected
                            ? "border-orange-500 bg-orange-950/30 ring-1 ring-orange-500"
                            : "border-slate-800 bg-slate-950/40 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-slate-100">
                                {s.name}
                              </h3>
                            </div>
                            <p className="text-xs text-slate-400 mt-1">
                              {s.desc}
                            </p>
                          </div>
                          <span className="text-lg font-bold font-mono text-orange-400">
                            {s.price.toLocaleString()}đ
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  2. Chọn nhà mạng mong muốn:
                </label>
                <select
                  value={selectedCarrier}
                  onChange={(e) => setSelectedCarrier(e.target.value)}
                  className="w-full bg-slate-950/80 border border-slate-800 text-slate-200 text-sm rounded-xl p-3 focus:outline-none focus:border-orange-500 cursor-pointer"
                >
                  {currentCarriers.map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                      className="bg-slate-900 text-slate-200"
                    >
                      📞 {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleRentNumber}
                disabled={
                  loading || (activeOrder && activeOrder.status === "waiting")
                }
                className="w-full font-bold py-4 rounded-xl shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2 text-base text-white bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 shadow-orange-500/20"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>Đang kết nối hệ thống nhà mạng...</span>
                  </>
                ) : (
                  <>
                    <Phone className="w-5 h-5" />
                    <span>
                      Thuê {selectedService.name} (
                      {selectedService.price.toLocaleString()}đ)
                    </span>
                  </>
                )}
              </button>
            </div>

            {activeOrder && (
              <div className="bg-slate-900/90 border border-orange-500/30 p-6 rounded-2xl shadow-2xl space-y-4">
                <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                  <span className="text-sm font-semibold text-orange-400 flex items-center gap-2">
                    <Clock className="w-4 h-4" /> Đơn thuê đang chạy:{" "}
                    {activeOrder.serviceName}
                  </span>
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                      activeOrder.status === "completed"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : activeOrder.status === "waiting"
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                    }`}
                  >
                    {activeOrder.status.toUpperCase()}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-400 block mb-1">
                      Số điện thoại nhận OTP:
                    </span>
                    <span className="text-2xl font-mono font-bold text-orange-400 tracking-wider">
                      {activeOrder.phoneNumber}
                    </span>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col justify-center">
                    <span className="text-xs text-slate-400 block mb-1">
                      Mã OTP Trả Về:
                    </span>
                    {activeOrder.otp ? (
                      <span className="text-3xl font-mono font-black text-emerald-400 tracking-widest animate-bounce">
                        {activeOrder.otp}
                      </span>
                    ) : (
                      <span className="text-sm text-amber-400 font-medium flex items-center gap-2 animate-pulse">
                        <RefreshCw className="w-4 h-4 animate-spin" /> Đang chờ
                        SMS gửi về...
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "deposit" && (
          <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-6 rounded-2xl shadow-xl space-y-6">
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <QrCode className="w-5 h-5 text-emerald-400" /> Nạp Tiền payOS Tự
              Động 24/7
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
              <div className="space-y-4 flex flex-col justify-between">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">
                      Mức nạp nhanh:
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[10000, 20000, 50000, 100000, 200000, 500000].map(
                        (amt) => (
                          <button
                            key={amt}
                            onClick={() => handleDepositChange(amt)}
                            className={`py-2 px-3 rounded-lg text-sm font-semibold border transition ${
                              Number(depositAmount) === amt
                                ? "border-emerald-500 bg-emerald-950/40 text-emerald-400"
                                : "border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700"
                            }`}
                          >
                            {amt.toLocaleString()}đ
                          </button>
                        ),
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">
                      Hoặc nhập số tiền tùy ý:
                    </label>
                    <input
                      type="number"
                      step="1000"
                      min="10000"
                      max="100000000"
                      value={depositAmount || ""}
                      onInput={(e) => {
                        if (e.target.value.length > 9) {
                          e.target.value = e.target.value.slice(0, 9);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (
                          e.key === "-" ||
                          e.key === "+" ||
                          e.key === "e" ||
                          e.key === "E"
                        ) {
                          e.preventDefault();
                        }
                      }}
                      onChange={(e) => handleDepositChange(e.target.value)}
                      className={`w-full bg-slate-950 border rounded-xl p-3 text-slate-100 font-mono outline-none transition ${
                        depositError
                          ? "border-rose-500 focus:border-rose-500"
                          : "border-slate-800 focus:border-emerald-500"
                      }`}
                    />
                    {depositError && (
                      <p className="text-rose-500 text-xs font-bold mt-2 flex items-center gap-1">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {depositError}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={handleGenerateQR}
                    disabled={depositLoading}
                    className="w-full max-w-full overflow-hidden bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-emerald-600/20 transition flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                  >
                    {depositLoading ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin shrink-0" />
                        <span className="truncate">
                          Đang khởi tạo hoá đơn...
                        </span>
                      </>
                    ) : (
                      <>
                        <QrCode className="w-5 h-5 shrink-0" />
                        <span className="truncate">
                          Tạo mã QR nạp tiền (
                          {Number(depositAmount || 0).toLocaleString()}đ)
                        </span>
                        <ArrowRight className="w-4 h-4 shrink-0" />
                      </>
                    )}
                  </button>
                </div>

                <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl text-amber-300 text-xs space-y-1">
                  <p className="font-bold flex items-center gap-1">
                    <ShieldAlert className="w-4 h-4" /> QUY ĐỊNH NẠP TIỀN TỰ
                    ĐỘNG:
                  </p>
                  <p>• Nhập số tiền và bấm "Tạo mã QR nạp tiền".</p>
                  <p>• Quét mã QR bằng App Ngân hàng bất kỳ.</p>
                  <p>• **Giữ nguyên nội dung chuyển khoản** do payOS tạo.</p>
                  <p>• Hệ thống sẽ tự động cộng tiền trong 5-30 giây!</p>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center p-6 bg-slate-950 border border-slate-800 rounded-2xl text-center min-h-[320px]">
                {depositSuccessMsg ? (
                  <div className="flex flex-col items-center justify-center space-y-3 p-4 animate-fade-in">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500 flex items-center justify-center text-emerald-400">
                      <CheckCircle2 className="w-10 h-10 animate-bounce" />
                    </div>
                    <h3 className="text-lg font-bold text-emerald-400">
                      Nạp tiền thành công!
                    </h3>
                    <p className="text-xs text-slate-400">
                      Số dư của bạn đã được cập nhật tự động vào hệ thống.
                    </p>
                  </div>
                ) : payosData && !depositError ? (
                  <div className="space-y-4 w-full flex flex-col items-center animate-fade-in">
                    <div className="p-3 bg-white rounded-xl shadow-xl border border-slate-700 flex flex-col items-center">
                      <img
                        src={getQrImageUrl()}
                        alt="Mã QR Thanh Toán"
                        className="w-56 h-56 object-contain rounded-lg"
                      />
                      <p className="text-[11px] text-slate-600 font-medium mt-2">
                        Mở App Ngân hàng bất kỳ để quét mã
                      </p>
                    </div>

                    <div className="w-full space-y-2 text-sm max-w-xs">
                      <div className="flex justify-between items-center bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                        <span className="text-slate-400 text-xs">
                          Nội dung CK:
                        </span>
                        <span className="font-mono font-bold text-amber-400">
                          {payosData.description}
                        </span>
                      </div>
                      <div className="flex justify-between items-center bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                        <span className="text-slate-400 text-xs">Số tiền:</span>
                        <span className="font-mono font-bold text-emerald-400">
                          {Number(depositAmount).toLocaleString()} VNĐ
                        </span>
                      </div>
                    </div>

                    <a
                      href={payosData.checkoutUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-emerald-400 transition underline pt-1"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Hoặc mở cổng
                      PayOS trên tab mới
                    </a>

                    <p className="text-xs text-emerald-400 flex items-center gap-1 animate-pulse font-medium">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Đang
                      chờ hệ thống ghi nhận tiền nạp...
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center p-6 text-slate-500 space-y-3">
                    <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400">
                      <QrCode className="w-8 h-8 opacity-40" />
                    </div>
                    <p className="text-sm font-medium text-slate-400">
                      Chưa tạo mã QR
                    </p>
                    <p className="text-xs text-slate-500 max-w-[220px]">
                      Vui lòng chọn số tiền và bấm nút{" "}
                      <span className="text-emerald-400 font-semibold">
                        "Tạo mã QR nạp tiền"
                      </span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "history" && (
          <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <History className="w-5 h-5 text-orange-400" /> Lịch sử giao dịch
            </h2>

            {transactions.length === 0 ? (
              <p className="text-slate-500 text-center py-8 text-sm">
                Chưa có lịch sử giao dịch nào.
              </p>
            ) : (
              <div className="space-y-2">
                {transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex justify-between items-center p-3.5 bg-slate-950/60 border border-slate-800/80 rounded-xl text-sm"
                  >
                    <div>
                      <p className="font-medium text-slate-200">
                        {tx.description || tx.type}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {new Date(tx.created_at).toLocaleString("vi-VN")}
                      </p>
                    </div>
                    <span
                      className={`font-mono font-bold ${
                        tx.amount > 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {tx.amount > 0
                        ? `+${tx.amount.toLocaleString()}`
                        : tx.amount.toLocaleString()}
                      đ
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL ĐỔI MẬT KHẨU */}
      {showChangePasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl relative">
            <button
              onClick={() => {
                setShowChangePasswordModal(false);
                setModalMsg(null);
              }}
              className="absolute right-4 top-4 text-slate-400 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-100">Đổi mật khẩu</h3>
                <p className="text-xs text-slate-400">Cập nhật mật khẩu mới cho tài khoản của bạn</p>
              </div>
            </div>

            {modalMsg && (
              <div
                className={`p-3 rounded-xl text-xs font-medium mb-4 flex items-center gap-2 ${
                  modalMsg.type === "error"
                    ? "bg-rose-500/10 border border-rose-500/20 text-rose-400"
                    : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                }`}
              >
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>{modalMsg.text}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Mật khẩu mới
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={64}
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-100 text-sm focus:outline-none focus:border-blue-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Xác nhận mật khẩu mới
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={64}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-100 text-sm focus:outline-none focus:border-blue-500 transition"
                />
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowChangePasswordModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-800 transition text-sm font-medium"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={changePassLoading}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {changePassLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Lưu thay đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="w-full max-w-5xl mx-auto my-6 px-4">
        <div className="bg-slate-100 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-4 sm:p-6 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-4 text-center md:text-left">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
              <MessageCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">
                Cần hỗ trợ thêm?
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Đội ngũ hỗ trợ sẵn sàng giúp đỡ bạn 24/7!
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            <a
              href="https://t.me/your_telegram_username"
              target="_blank"
              rel="noreferrer"
              className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl shadow-md transition"
            >
              <Send className="w-4 h-4" />
              <span>Tham gia Telegram</span>
            </a>

            <a
              href="https://m.me/your_facebook_page_id"
              target="_blank"
              rel="noreferrer"
              className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-xl shadow-md transition"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Messenger</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}