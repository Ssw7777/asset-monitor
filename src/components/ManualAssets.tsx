"use client";

import { useState } from "react";
import type { ManualAsset } from "@/lib/types";
import { usd } from "./format";

export function ManualAssets({
  items,
  onChange,
}: {
  items: ManualAsset[];
  onChange: (manual: ManualAsset[]) => void;
}) {
  const [saving, setSaving] = useState(false);
  const total = items.reduce((a, m) => a + (Number(m.amountUsd) || 0), 0);

  async function save(item: ManualAsset) {
    setSaving(true);
    try {
      const res = await fetch("/api/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      const data = await res.json();
      if (res.ok) onChange(data.manual);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/manual?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) onChange(data.manual);
    } finally {
      setSaving(false);
    }
  }

  async function add() {
    const item: ManualAsset = {
      id: `m_${Date.now()}`,
      name: "新资产",
      amountUsd: 0,
      updatedAt: new Date().toISOString(),
    };
    await save(item);
  }

  function patchLocal(id: string, patch: Partial<ManualAsset>) {
    onChange(items.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  return (
    <section className="card p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-xs tracking-wider text-gray-400 font-medium">MANUAL</div>
          <h2 className="text-lg font-semibold">手动资产</h2>
          <p className="text-sm text-gray-400 mt-1">记录不方便接入 API 或钱包地址的小额资产，自动计入总余额。</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-orange-100 text-orange-800 px-3 py-1 text-sm font-semibold">{usd(total)}</span>
          <button onClick={add} className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50">
            + 继续添加
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 overflow-hidden">
        <div className="grid grid-cols-[1fr_140px_64px] gap-2 px-4 py-2 text-xs text-gray-400 bg-gray-50">
          <div>用途</div>
          <div className="text-right">金额 (U / USD)</div>
          <div className="text-right">操作</div>
        </div>
        {items.map((m) => (
          <div key={m.id} className="grid grid-cols-[1fr_140px_64px] gap-2 px-4 py-2.5 border-t border-gray-50 items-center">
            <input
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={m.name}
              onChange={(e) => patchLocal(m.id, { name: e.target.value })}
              onBlur={() => save({ ...m, updatedAt: new Date().toISOString() })}
            />
            <input
              type="number"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-right"
              value={m.amountUsd}
              onChange={(e) => patchLocal(m.id, { amountUsd: Number(e.target.value) })}
              onBlur={() => save({ ...m, updatedAt: new Date().toISOString() })}
            />
            <button onClick={() => remove(m.id)} className="text-sm text-red-500 text-right hover:underline">
              删除
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-3">
        <span>{saving ? "保存中…" : "修改后自动保存"}</span>
        <span>{items.length} 条记录</span>
      </div>
    </section>
  );
}
