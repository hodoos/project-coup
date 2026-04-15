"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type UserType = {
  id: string;
  email?: string;
};

type DriverSettings = {
  driver_name: string;
  unit_price: string;
  settlement_start_day: string;
  settlement_start_month_offset: string;
  settlement_end_day: string;
  settlement_end_month_offset: string;
  off_days: number[];
  biweekly_off_days: number[];
  biweekly_anchor_date: string;
};

type ReportForm = {
  report_date: string;
  delivered_count: string;
  returned_count: string;
  canceled_count: string;
  memo: string;
  is_day_off: boolean;
  unit_price_override: string;
};

type DailyReportRow = {
  id: number;
  user_id: string;
  report_date: string;
  delivered_count: number;
  returned_count: number;
  canceled_count: number;
  memo: string | null;
  daily_sales: number;
  is_day_off: boolean;
  unit_price_override: number | null;
};

function formatMoney(value: number) {
  return `${value.toLocaleString()}원`;
}

function getKoreanDayLabel(day: number) {
  return ["일", "월", "화", "수", "목", "금", "토"][day];
}

function toDateString(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const d = startOfDay(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function eachDateBetween(start: Date, end: Date) {
  const result: Date[] = [];
  const current = new Date(start);

  while (current <= end) {
    result.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return result;
}

function buildSettlementCalendarGrid(start: Date, end: Date) {
  const startDayOfWeek = start.getDay();
  const leadingNulls = Array.from({ length: startDayOfWeek }, () => null);
  const dates = eachDateBetween(start, end);
  const cells = [...leadingNulls, ...dates];

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function getSettlementRange(
  baseDate: Date,
  startDay: number,
  startMonthOffset: number,
  endDay: number,
  endMonthOffset: number
) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();

  return {
    start: new Date(year, month + startMonthOffset, startDay),
    end: new Date(year, month + endMonthOffset, endDay),
  };
}

function shiftSettlementAnchor(anchorDate: Date, diffMonths: number) {
  return new Date(
    anchorDate.getFullYear(),
    anchorDate.getMonth() + diffMonths,
    1
  );
}

function isBiweeklyOffDate(
  date: Date,
  biweeklyOffDays: number[],
  anchorDateString: string
) {
  if (!anchorDateString) return false;
  if (!biweeklyOffDays.includes(date.getDay())) return false;

  const anchor = new Date(anchorDateString);
  const weekA = startOfWeek(anchor);
  const weekB = startOfWeek(date);
  const diffMs = weekB.getTime() - weekA.getTime();
  const diffWeeks = Math.round(diffMs / (1000 * 60 * 60 * 24 * 7));

  return Math.abs(diffWeeks) % 2 === 0;
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-3xl border border-black/10 bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
      <p className="text-xs font-semibold tracking-wide text-black/55">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-black">{value}</p>
      {sub ? <p className="mt-1 text-xs text-black/45">{sub}</p> : null}
    </div>
  );
}

export default function Home() {
  const now = new Date();
  const todayString = toDateString(now);

  const emptyReportForm = (dateKey: string): ReportForm => ({
    report_date: dateKey,
    delivered_count: "",
    returned_count: "",
    canceled_count: "",
    memo: "",
    is_day_off: false,
    unit_price_override: "",
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [isSignupModalOpen, setIsSignupModalOpen] = useState(false);

  const [user, setUser] = useState<UserType | null>(null);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<"calendar" | "settings">("calendar");
  const [periodAnchor, setPeriodAnchor] = useState<Date>(
    new Date(now.getFullYear(), now.getMonth(), 1)
  );

  const [settings, setSettings] = useState<DriverSettings>({
    driver_name: "",
    unit_price: "",
    settlement_start_day: "26",
    settlement_start_month_offset: "-1",
    settlement_end_day: "25",
    settlement_end_month_offset: "0",
    off_days: [],
    biweekly_off_days: [],
    biweekly_anchor_date: "",
  });

  const [reportForm, setReportForm] = useState<ReportForm>(
    emptyReportForm(todayString)
  );

  const [reports, setReports] = useState<DailyReportRow[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayString);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [reportsLoading, setReportsLoading] = useState(false);

  const defaultUnitPrice = Number(settings.unit_price || 0);

  const startDayNum = Number(settings.settlement_start_day || 1);
  const startMonthOffsetNum = Number(settings.settlement_start_month_offset || 0);
  const endDayNum = Number(settings.settlement_end_day || 31);
  const endMonthOffsetNum = Number(settings.settlement_end_month_offset || 0);

  const settlementRange = useMemo(() => {
    return getSettlementRange(
      periodAnchor,
      startDayNum,
      startMonthOffsetNum,
      endDayNum,
      endMonthOffsetNum
    );
  }, [
    periodAnchor,
    startDayNum,
    startMonthOffsetNum,
    endDayNum,
    endMonthOffsetNum,
  ]);

  const reportsMap = useMemo(() => {
    const map = new Map<string, DailyReportRow>();
    reports.forEach((report) => {
      map.set(report.report_date, report);
    });
    return map;
  }, [reports]);

  const calendarCells = useMemo(() => {
    return buildSettlementCalendarGrid(settlementRange.start, settlementRange.end);
  }, [settlementRange]);

  useEffect(() => {
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setUser({
          id: user.id,
          email: user.email,
        });
      }

      setLoading(false);
    };

    getUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email,
        });
      } else {
        setUser(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (user) {
      fetchSettings();
    }
  }, [user]);

  useEffect(() => {
    if (user && view === "calendar") {
      fetchReports();
    }
  }, [user, view, settlementRange.start.getTime(), settlementRange.end.getTime()]);

  const fetchSettings = async () => {
    if (!user) return;

    setSettingsLoading(true);

    const { data, error } = await supabase
      .from("driver_settings")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (error) {
      if (error.code !== "PGRST116") {
        alert("기본설정 불러오기 실패: " + error.message);
      }
      setSettingsLoading(false);
      return;
    }

    setSettings({
      driver_name: data.driver_name ?? "",
      unit_price: data.unit_price ? String(data.unit_price) : "",
      settlement_start_day: data.settlement_start_day
        ? String(data.settlement_start_day)
        : "26",
      settlement_start_month_offset:
        data.settlement_start_month_offset !== null &&
        data.settlement_start_month_offset !== undefined
          ? String(data.settlement_start_month_offset)
          : "-1",
      settlement_end_day: data.settlement_end_day
        ? String(data.settlement_end_day)
        : "25",
      settlement_end_month_offset:
        data.settlement_end_month_offset !== null &&
        data.settlement_end_month_offset !== undefined
          ? String(data.settlement_end_month_offset)
          : "0",
      off_days: Array.isArray(data.off_days) ? data.off_days : [],
      biweekly_off_days: Array.isArray(data.biweekly_off_days)
        ? data.biweekly_off_days
        : [],
      biweekly_anchor_date: data.biweekly_anchor_date ?? "",
    });

    setSettingsLoading(false);
  };

  const fetchReports = async () => {
    if (!user) return;

    setReportsLoading(true);

    const { data, error } = await supabase
      .from("daily_reports")
      .select("*")
      .eq("user_id", user.id)
      .gte("report_date", toDateString(settlementRange.start))
      .lte("report_date", toDateString(settlementRange.end))
      .order("report_date", { ascending: true });

    setReportsLoading(false);

    if (error) {
      alert("리포트 불러오기 실패: " + error.message);
      return;
    }

    setReports((data as DailyReportRow[]) ?? []);
  };

  const handleSettingsChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;

    if (name === "biweekly_anchor_date") {
      if (!value) {
        setSettings((prev) => ({
          ...prev,
          biweekly_anchor_date: "",
          biweekly_off_days: [],
        }));
        return;
      }

      const selected = new Date(value);
      const weekday = selected.getDay();

      setSettings((prev) => ({
        ...prev,
        biweekly_anchor_date: value,
        biweekly_off_days: [weekday],
      }));
      return;
    }

    setSettings((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleReportChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;

    setReportForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const toggleWeeklyOffDay = (day: number) => {
    setSettings((prev) => {
      const exists = prev.off_days.includes(day);
      return {
        ...prev,
        off_days: exists
          ? prev.off_days.filter((d) => d !== day)
          : [...prev.off_days, day].sort((a, b) => a - b),
      };
    });
  };

  const saveSettings = async () => {
    if (!user) return;

    setSaving(true);

    const payload = {
      user_id: user.id,
      driver_name: settings.driver_name,
      unit_price: settings.unit_price ? Number(settings.unit_price) : null,
      settlement_start_day: startDayNum,
      settlement_start_month_offset: startMonthOffsetNum,
      settlement_end_day: endDayNum,
      settlement_end_month_offset: endMonthOffsetNum,
      off_days: settings.off_days,
      biweekly_off_days: settings.biweekly_off_days,
      biweekly_anchor_date: settings.biweekly_anchor_date || null,
    };

    const { error } = await supabase
      .from("driver_settings")
      .upsert(payload, { onConflict: "user_id" });

    setSaving(false);

    if (error) {
      alert("기본설정 저장 실패: " + error.message);
      return;
    }

    alert("기본설정 저장 완료");
    setView("calendar");
    setPeriodAnchor(new Date(now.getFullYear(), now.getMonth(), 1));
    await fetchSettings();
  };

  const openReportModal = (dateKey: string) => {
    setSelectedDate(dateKey);

    const existing = reportsMap.get(dateKey);

    if (existing) {
      setReportForm({
        report_date: existing.report_date,
        delivered_count: String(existing.delivered_count ?? ""),
        returned_count: String(existing.returned_count ?? ""),
        canceled_count: String(existing.canceled_count ?? ""),
        memo: existing.memo ?? "",
        is_day_off: Boolean(existing.is_day_off),
        unit_price_override: existing.unit_price_override
          ? String(existing.unit_price_override)
          : "",
      });
    } else {
      setReportForm(emptyReportForm(dateKey));
    }

    setIsReportModalOpen(true);
  };

  const closeReportModal = () => {
    setIsReportModalOpen(false);
    setReportForm(emptyReportForm(todayString));
  };

  const appliedUnitPrice = reportForm.unit_price_override
    ? Number(reportForm.unit_price_override)
    : defaultUnitPrice;

  const saveReport = async () => {
    if (!user) return;

    if (!settings.unit_price) {
      alert("먼저 기본설정에서 배송 단가를 입력해주세요.");
      return;
    }

    const isEmptyReport =
      !reportForm.is_day_off &&
      reportForm.delivered_count === "" &&
      reportForm.returned_count === "" &&
      reportForm.canceled_count === "" &&
      reportForm.memo.trim() === "" &&
      reportForm.unit_price_override === "";

    if (isEmptyReport) {
      setSaving(true);

      const { error } = await supabase
        .from("daily_reports")
        .delete()
        .eq("user_id", user.id)
        .eq("report_date", reportForm.report_date);

      setSaving(false);

      if (error) {
        alert("미입력 처리 실패: " + error.message);
        return;
      }

      alert("미입력 상태로 변경됨");
      setIsReportModalOpen(false);
      setReportForm(emptyReportForm(todayString));
      await fetchReports();
      return;
    }

    setSaving(true);

    const deliveredCount = reportForm.is_day_off
      ? 0
      : Number(reportForm.delivered_count || 0);

    const payload = {
      user_id: user.id,
      report_date: reportForm.report_date,
      delivered_count: deliveredCount,
      returned_count: reportForm.is_day_off
        ? 0
        : Number(reportForm.returned_count || 0),
      canceled_count: reportForm.is_day_off
        ? 0
        : Number(reportForm.canceled_count || 0),
      memo: reportForm.memo,
      daily_sales: reportForm.is_day_off ? 0 : deliveredCount * appliedUnitPrice,
      is_day_off: reportForm.is_day_off,
      unit_price_override: reportForm.unit_price_override
        ? Number(reportForm.unit_price_override)
        : null,
    };

    const { error } = await supabase
      .from("daily_reports")
      .upsert(payload, { onConflict: "user_id,report_date" });

    setSaving(false);

    if (error) {
      alert("저장 실패: " + error.message);
      return;
    }

    alert("저장 완료");
    setIsReportModalOpen(false);
    setReportForm(emptyReportForm(todayString));
    await fetchReports();
  };

  const signUp = async () => {
    const { data, error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
    });

    if (error) {
      alert(error.message);
      return;
    }

    if (data.user && data.session) {
      setUser({
        id: data.user.id,
        email: data.user.email,
      });
    }

    alert("회원가입 완료");
    setSignupEmail("");
    setSignupPassword("");
    setIsSignupModalOpen(false);
  };

  const signIn = async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      alert(error.message);
      return;
    }

    if (data.user) {
      setUser({
        id: data.user.id,
        email: data.user.email,
      });
    }

    alert("로그인 성공");
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      alert(error.message);
      return;
    }

    setUser(null);
    setView("calendar");
    setIsReportModalOpen(false);
    setReportForm(emptyReportForm(todayString));
    alert("로그아웃 완료");
  };

  const goPrevPeriod = () => {
    setPeriodAnchor(shiftSettlementAnchor(periodAnchor, -1));
  };

  const goNextPeriod = () => {
    setPeriodAnchor(shiftSettlementAnchor(periodAnchor, 1));
  };

  const summary = useMemo(() => {
    const allDates = eachDateBetween(settlementRange.start, settlementRange.end);

    const periodDates = allDates.map((date) => {
      const key = toDateString(date);
      const report = reportsMap.get(key);
      const isWeeklyRegularOff = settings.off_days.includes(date.getDay());
      const isBiweeklyRegularOff = isBiweeklyOffDate(
        date,
        settings.biweekly_off_days,
        settings.biweekly_anchor_date
      );
      const isRegularOff = isWeeklyRegularOff || isBiweeklyRegularOff;

      const isWorked = Boolean(
        report &&
          !report.is_day_off &&
          (report.delivered_count > 0 ||
            report.returned_count > 0 ||
            report.canceled_count > 0 ||
            (report.memo && report.memo.trim() !== "") ||
            report.unit_price_override)
      );

      const isAdditionalOff = Boolean(
        report && report.is_day_off && !isRegularOff
      );

      return {
        key,
        date,
        report,
        isRegularOff,
        isWorked,
        isAdditionalOff,
      };
    });

    const workedDays = periodDates.filter((item) => item.isWorked).length;
    const additionalOffDays = periodDates.filter(
      (item) => item.isAdditionalOff
    ).length;

    const totalDelivered = periodDates.reduce((sum, item) => {
      if (!item.isWorked || !item.report) return sum;
      return sum + (item.report.delivered_count || 0);
    }, 0);

    const totalSales = periodDates.reduce((sum, item) => {
      if (!item.isWorked || !item.report) return sum;
      return sum + (item.report.daily_sales || 0);
    }, 0);

    const avgQty = workedDays > 0 ? Math.round(totalDelivered / workedDays) : 0;
    const avgSales = workedDays > 0 ? Math.round(totalSales / workedDays) : 0;

    const totalPeriodDays = allDates.length;
    const regularOffDays = periodDates.filter((item) => item.isRegularOff).length;
    const adjustedPeriodDays = totalPeriodDays - regularOffDays;

    const remainingWorkDays = Math.max(
      adjustedPeriodDays - workedDays - additionalOffDays,
      0
    );

    const expectedSales = avgSales * remainingWorkDays;

    return {
      avgQty,
      avgSales,
      totalSales,
      expectedSales,
      totalPeriodDays,
      regularOffDays,
      adjustedPeriodDays,
      workedDays,
      additionalOffDays,
      remainingWorkDays,
    };
  }, [
    reportsMap,
    settlementRange,
    settings.off_days,
    settings.biweekly_off_days,
    settings.biweekly_anchor_date,
  ]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f6f7fb] p-4 flex items-center justify-center text-black">
        <div className="rounded-[28px] border border-black/8 bg-white px-6 py-5 shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
          불러오는 중...
        </div>
      </main>
    );
  }

  if (user) {
    if (view === "settings") {
      return (
        <main className="min-h-screen bg-[#f6f7fb] p-4 text-black md:p-6">
          <div className="mx-auto max-w-4xl space-y-5">
            <div className="flex items-center justify-between rounded-[28px] border border-black/8 bg-white px-5 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.06)]">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">기본 설정</h1>
                <p className="mt-1 text-sm text-black/55">업무 기준값과 휴무 패턴을 설정합니다.</p>
              </div>
              <button
                onClick={() => setView("calendar")}
                className="rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-black hover:text-white"
              >
                달력으로 돌아가기
              </button>
            </div>

            <div className="rounded-[32px] border border-black/8 bg-white p-5 shadow-[0_20px_60px_rgba(0,0,0,0.06)] md:p-7">
              {settingsLoading ? (
                <div className="text-black">설정 불러오는 중...</div>
              ) : (
                <div className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-black/70">기사명</label>
                      <input
                        type="text"
                        name="driver_name"
                        value={settings.driver_name}
                        onChange={handleSettingsChange}
                        placeholder="기사명"
                        className="w-full rounded-2xl border border-black/10 bg-[#fafafa] px-4 py-3 text-black outline-none transition focus:border-black/30 focus:bg-white"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-black/70">배송 단가</label>
                      <input
                        type="number"
                        name="unit_price"
                        value={settings.unit_price}
                        onChange={handleSettingsChange}
                        placeholder="배송 단가(원)"
                        className="no-spinner w-full rounded-2xl border border-black/10 bg-[#fafafa] px-4 py-3 text-black outline-none transition focus:border-black/30 focus:bg-white"
                      />
                    </div>
                  </div>

                  <div className="rounded-3xl border border-black/8 bg-[#fafafa] p-4">
                    <p className="mb-3 text-sm font-semibold text-black/75">정산 기간 설정</p>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="grid gap-3">
                        <select
                          name="settlement_start_month_offset"
                          value={settings.settlement_start_month_offset}
                          onChange={handleSettingsChange}
                          className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-black outline-none"
                        >
                          <option value="-1">시작월: 지난달</option>
                          <option value="0">시작월: 이번달</option>
                        </select>

                        <select
                          name="settlement_start_day"
                          value={settings.settlement_start_day}
                          onChange={handleSettingsChange}
                          className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-black outline-none"
                        >
                          {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                            <option key={day} value={day}>
                              시작일 {day}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid gap-3">
                        <select
                          name="settlement_end_month_offset"
                          value={settings.settlement_end_month_offset}
                          onChange={handleSettingsChange}
                          className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-black outline-none"
                        >
                          <option value="0">종료월: 이번달</option>
                          <option value="1">종료월: 다음달</option>
                        </select>

                        <select
                          name="settlement_end_day"
                          value={settings.settlement_end_day}
                          onChange={handleSettingsChange}
                          className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-black outline-none"
                        >
                          {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                            <option key={day} value={day}>
                              종료일 {day}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-black/8 bg-[#fafafa] p-4">
                    <p className="mb-3 text-sm font-semibold text-black/75">매주 휴무</p>
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: 7 }, (_, i) => i).map((day) => {
                        const active = settings.off_days.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => toggleWeeklyOffDay(day)}
                            className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
                              active
                                ? "bg-black text-white shadow-[0_10px_25px_rgba(0,0,0,0.18)]"
                                : "border border-black/10 bg-white text-black hover:border-black/20"
                            }`}
                          >
                            {getKoreanDayLabel(day)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-black/8 bg-[#fafafa] p-4">
                    <p className="mb-2 text-sm font-semibold text-black/75">
                      격주휴무 기준일을 선택해주세요
                    </p>
                    <input
                      type="date"
                      name="biweekly_anchor_date"
                      value={settings.biweekly_anchor_date}
                      onChange={handleSettingsChange}
                      className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-black outline-none md:max-w-sm"
                    />
                    {settings.biweekly_anchor_date && settings.biweekly_off_days.length > 0 && (
                      <p className="mt-2 text-sm text-black/55">
                        선택된 요일: {getKoreanDayLabel(settings.biweekly_off_days[0])}요일
                      </p>
                    )}
                  </div>

                  <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="w-full rounded-2xl bg-black px-4 py-3.5 text-base font-semibold text-white shadow-[0_16px_32px_rgba(0,0,0,0.18)] transition hover:translate-y-[-1px] disabled:opacity-50"
                  >
                    {saving ? "저장 중..." : "저장"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </main>
      );
    }

    return (
      <main className="min-h-screen bg-[#f6f7fb] p-4 text-black md:p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="rounded-[32px] border border-black/8 bg-white px-5 py-5 shadow-[0_20px_60px_rgba(0,0,0,0.06)] md:px-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold tracking-[0.2em] text-black/40">
                  DRIVER REPORT
                </p>
                <h1 className="mt-1 text-3xl font-bold tracking-tight">
                  업무 리포트 달력
                </h1>
                <p className="mt-1 text-sm text-black/60">
                  {settings.driver_name ? `${settings.driver_name} 기사님` : user.email}
                </p>
                <p className="mt-1 text-sm font-medium text-black/70">
                  정산기간: {toDateString(settlementRange.start)} ~{" "}
                  {toDateString(settlementRange.end)}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setView("settings")}
                  className="rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:border-black/20 hover:bg-black hover:text-white"
                >
                  기본설정
                </button>
                <button
                  onClick={signOut}
                  className="rounded-2xl bg-black px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(0,0,0,0.18)] transition hover:translate-y-[-1px]"
                >
                  로그아웃
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-[32px] border border-black/8 bg-white p-4 shadow-[0_20px_60px_rgba(0,0,0,0.06)] md:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <button
                onClick={goPrevPeriod}
                className="rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:border-black/20 hover:bg-black hover:text-white"
              >
                이전달
              </button>

              <h2 className="text-center text-lg font-bold tracking-tight md:text-2xl">
                {toDateString(settlementRange.start)} ~ {toDateString(settlementRange.end)}
              </h2>

              <button
                onClick={goNextPeriod}
                className="rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:border-black/20 hover:bg-black hover:text-white"
              >
                다음달
              </button>
            </div>

            <div className="mb-2 grid grid-cols-7 gap-2">
              {["일", "월", "화", "수", "목", "금", "토"].map((label) => (
                <div
                  key={label}
                  className="rounded-2xl bg-[#f5f6fa] px-2 py-3 text-center text-xs font-bold text-black/65 md:text-sm"
                >
                  {label}
                </div>
              ))}
            </div>

            {reportsLoading ? (
              <div className="py-12 text-center text-black/60">달력 불러오는 중...</div>
            ) : (
              <div className="grid grid-cols-7 gap-2">
                {calendarCells.map((cell, index) => {
                  if (!cell) {
                    return <div key={`empty-${index}`} className="min-h-[104px] md:min-h-[120px]" />;
                  }

                  const dateKey = toDateString(cell);
                  const report = reportsMap.get(dateKey);
                  const isToday = dateKey === todayString;
                  const isWeeklyRegularOff = settings.off_days.includes(cell.getDay());
                  const isBiweeklyRegularOff = isBiweeklyOffDate(
                    cell,
                    settings.biweekly_off_days,
                    settings.biweekly_anchor_date
                  );
                  const isRegularOff = isWeeklyRegularOff || isBiweeklyRegularOff;

                  const isEmptySavedReport =
                    report &&
                    !report.is_day_off &&
                    report.delivered_count === 0 &&
                    report.returned_count === 0 &&
                    report.canceled_count === 0 &&
                    (!report.memo || report.memo.trim() === "") &&
                    !report.unit_price_override;

                  return (
                    <button
                      key={dateKey}
                      onClick={() => openReportModal(dateKey)}
                      className={`min-h-[104px] rounded-3xl border p-3 text-left shadow-[0_8px_24px_rgba(0,0,0,0.04)] transition hover:translate-y-[-1px] md:min-h-[120px] ${
                        isToday
                          ? "border-black bg-[#f3f4f7]"
                          : "border-black/8 bg-white"
                      }`}
                    >
                      <div className="text-sm font-bold text-black md:text-base">
                        {cell.getDate()}
                      </div>

                      <div className="mt-2 space-y-1 text-[11px] md:text-xs">
                        {report ? (
                          report.is_day_off ? (
                            <div className="font-semibold text-red-600">추가휴무</div>
                          ) : isEmptySavedReport ? (
                            isWeeklyRegularOff ? (
                              <div className="font-semibold text-red-600">정기휴무</div>
                            ) : isBiweeklyRegularOff ? (
                              <div className="font-semibold text-red-600">격주휴무</div>
                            ) : (
                              <div className="text-black/45">미입력</div>
                            )
                          ) : (
                            <>
                              <div className="text-black/70">배송 {report.delivered_count}</div>
                              <div className="font-semibold text-black">
                                {formatMoney(report.daily_sales)}
                              </div>
                            </>
                          )
                        ) : isWeeklyRegularOff ? (
                          <div className="font-semibold text-red-600">정기휴무</div>
                        ) : isBiweeklyRegularOff ? (
                          <div className="font-semibold text-red-600">격주휴무</div>
                        ) : (
                          <div className="text-black/45">미입력</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <StatCard label="평균 수량" value={`${summary.avgQty}건`} />
            <StatCard label="평균 매출" value={formatMoney(summary.avgSales)} />
            <StatCard label="현재까지 총 수익" value={formatMoney(summary.totalSales)} />
            <StatCard label="예상 매출" value={formatMoney(summary.expectedSales)} />
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <StatCard
              label="정산기간 일 수"
              value={`${summary.adjustedPeriodDays}일`}
              sub={`전체 ${summary.totalPeriodDays}일 - 정기/격주휴무 ${summary.regularOffDays}일`}
            />
            <StatCard label="근무한 일 수" value={`${summary.workedDays}일`} />
            <StatCard label="추가휴무 일 수" value={`${summary.additionalOffDays}일`} />
            <StatCard label="앞으로 남은 근무 일 수" value={`${summary.remainingWorkDays}일`} />
          </div>
        </div>

        {isReportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 backdrop-blur-sm md:items-center md:p-4">
            <div className="w-full max-w-md rounded-t-[32px] border border-black/8 bg-white p-5 shadow-[0_30px_80px_rgba(0,0,0,0.18)] md:rounded-[32px]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold tracking-tight text-black">{selectedDate}</h3>
                  <p className="mt-1 text-sm text-black/50">일일 리포트 입력</p>
                </div>
                <button
                  onClick={closeReportModal}
                  className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-black transition hover:bg-black hover:text-white"
                >
                  닫기
                </button>
              </div>

              <div className="space-y-3.5">
                <div className="flex items-center gap-2 rounded-2xl bg-[#f7f8fb] px-3 py-3">
                  <input
                    id="dayoff"
                    type="checkbox"
                    checked={reportForm.is_day_off}
                    onChange={(e) =>
                      setReportForm((prev) => ({
                        ...prev,
                        is_day_off: e.target.checked,
                        delivered_count: e.target.checked ? "" : prev.delivered_count,
                        returned_count: e.target.checked ? "" : prev.returned_count,
                        canceled_count: e.target.checked ? "" : prev.canceled_count,
                      }))
                    }
                  />
                  <label htmlFor="dayoff" className="font-semibold text-black">
                    휴무
                  </label>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-black/70">단가</label>
                  <input
                    type="number"
                    name="unit_price_override"
                    value={reportForm.unit_price_override}
                    onChange={handleReportChange}
                    disabled={reportForm.is_day_off}
                    placeholder={defaultUnitPrice ? `${defaultUnitPrice}원` : "단가"}
                    className="no-spinner w-full rounded-2xl border border-black/10 bg-[#fafafa] px-4 py-3 text-black placeholder:text-black/35 outline-none transition focus:border-black/25 focus:bg-white disabled:bg-[#f2f3f6]"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-black/70">배송 건수</label>
                    <input
                      type="number"
                      name="delivered_count"
                      value={reportForm.delivered_count}
                      onChange={handleReportChange}
                      disabled={reportForm.is_day_off}
                      placeholder="배송 건수"
                      className="no-spinner w-full rounded-2xl border border-black/10 bg-[#fafafa] px-3 py-3 text-black placeholder:text-black/35 outline-none transition focus:border-black/25 focus:bg-white disabled:bg-[#f2f3f6]"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-black/70">반품</label>
                    <input
                      type="number"
                      name="returned_count"
                      value={reportForm.returned_count}
                      onChange={handleReportChange}
                      disabled={reportForm.is_day_off}
                      placeholder="반품"
                      className="no-spinner w-full rounded-2xl border border-black/10 bg-[#fafafa] px-3 py-3 text-black placeholder:text-black/35 outline-none transition focus:border-black/25 focus:bg-white disabled:bg-[#f2f3f6]"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-black/70">취소</label>
                    <input
                      type="number"
                      name="canceled_count"
                      value={reportForm.canceled_count}
                      onChange={handleReportChange}
                      disabled={reportForm.is_day_off}
                      placeholder="취소"
                      className="no-spinner w-full rounded-2xl border border-black/10 bg-[#fafafa] px-3 py-3 text-black placeholder:text-black/35 outline-none transition focus:border-black/25 focus:bg-white disabled:bg-[#f2f3f6]"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-black/70">특이사항</label>
                  <textarea
                    name="memo"
                    value={reportForm.memo}
                    onChange={handleReportChange}
                    className="min-h-[96px] w-full rounded-2xl border border-black/10 bg-[#fafafa] px-4 py-3 text-black outline-none transition focus:border-black/25 focus:bg-white"
                  />
                </div>

                <button
                  onClick={saveReport}
                  disabled={saving}
                  className="w-full rounded-2xl bg-black px-4 py-3.5 text-base font-semibold text-white shadow-[0_16px_32px_rgba(0,0,0,0.18)] transition hover:translate-y-[-1px] disabled:opacity-50"
                >
                  {saving ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#ffffff,_#eef2ff_38%,_#f6f7fb_70%)] px-4 py-6 text-black md:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl items-center justify-center">
        <div className="w-full max-w-md">
          <div className="rounded-[36px] border border-black/8 bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.08)] md:p-8">
            <div className="mb-6 text-center">
              <p className="text-xs font-semibold tracking-[0.24em] text-black/40">
                DRIVER REPORT
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-black">
                기사 플랫폼 로그인
              </h1>
              <p className="mt-2 text-sm leading-6 text-black/55">
                로그인 후 정산기간 달력과 업무 리포트를 바로 사용할 수 있습니다.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-black/70">이메일</label>
                <input
                  type="email"
                  placeholder="이메일"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-2xl border border-black/10 bg-[#fafafa] px-4 py-3 text-black outline-none transition focus:border-black/25 focus:bg-white"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-black/70">비밀번호</label>
                <input
                  type="password"
                  placeholder="비밀번호"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-2xl border border-black/10 bg-[#fafafa] px-4 py-3 text-black outline-none transition focus:border-black/25 focus:bg-white"
                />
              </div>

              <button
                onClick={signIn}
                className="w-full rounded-2xl bg-black py-3.5 text-base font-semibold text-white shadow-[0_16px_32px_rgba(0,0,0,0.18)] transition hover:translate-y-[-1px]"
              >
                로그인
              </button>

              <button
                onClick={() => setIsSignupModalOpen(true)}
                className="w-full rounded-2xl border border-black/10 bg-white py-3.5 text-base font-semibold text-black transition hover:bg-black hover:text-white"
              >
                회원가입
              </button>
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-black/70">
            kakao talk : morobb
          </p>
        </div>
      </div>

      {isSignupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 backdrop-blur-sm md:items-center md:p-4">
          <div className="w-full max-w-md rounded-t-[32px] border border-black/8 bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.18)] md:rounded-[32px]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-[0.24em] text-black/40">
                  SIGN UP
                </p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-black">
                  회원가입
                </h2>
              </div>
              <button
                onClick={() => setIsSignupModalOpen(false)}
                className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-black transition hover:bg-black hover:text-white"
              >
                닫기
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-black/70">이메일</label>
                <input
                  type="email"
                  placeholder="이메일"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  className="w-full rounded-2xl border border-black/10 bg-[#fafafa] px-4 py-3 text-black outline-none transition focus:border-black/25 focus:bg-white"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-black/70">비밀번호</label>
                <input
                  type="password"
                  placeholder="비밀번호"
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  className="w-full rounded-2xl border border-black/10 bg-[#fafafa] px-4 py-3 text-black outline-none transition focus:border-black/25 focus:bg-white"
                />
              </div>

              <button
                onClick={signUp}
                className="w-full rounded-2xl bg-black py-3.5 text-base font-semibold text-white shadow-[0_16px_32px_rgba(0,0,0,0.18)] transition hover:translate-y-[-1px]"
              >
                회원가입 완료
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .no-spinner::-webkit-outer-spin-button,
        .no-spinner::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }

        .no-spinner {
          -moz-appearance: textfield;
        }
      `}</style>
    </main>
  );
}