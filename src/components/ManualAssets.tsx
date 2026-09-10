"use client";

import { useState } from "react";
import type { ManualAsset } from "@/lib/types";
import { timeAgo, usd } from "./format";

/** 手动资产：直接可编辑，改动即时并入总额、CNY 与历史快照。 */
export function ManualAssets({
  items,
  onChange,
}: {
  items: ManualAsset[];
  onChange: (manual: ManualAsset[]) => void;
}) {
  const [saving, setSaving] = useState(false);
  const total = items.reduce((sum, item) => sum + (Number(item.amountUsd) || 0), 0);

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
    if (!confirm("确认删除这条手动资产？删除后立即重新计算总额。")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/manual?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) onChange(data.manual);
    } finally {
      setSaving(false);
    }
  }

  function add() {
    void save({
      id: `m_${Date.now()}`,
      name: "新资产",
      amountUsd: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  function patchLocal(id: string, patch: Partial<ManualAsset>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  return (
    <section className="section" id="manual">
      <div className="section-head">
        <div className="section-title">
          <h2>手动资产</h2>
          <span className="hint">不方便接 API 的小额账户，自动计入总额</span>
        </div>
        <div className="inline">
          <span className="section-total num">{usd(total)}</span>
          <button type="button" className="btn btn-accent" onClick={add} disabled={saving}>
            + 添加
          </button>
        </div>
      </div>

      <div className="table">
        <div className="thead grid-manual">
          <div>用途</div>
          <div className="right">金额（U）</div>
          <div className="right">操作</div>
        </div>
        {items.map((item) => (
          <div className="trow grid-manual" key={item.id}>
            <input
              className="field"
              aria-label="用途"
              value={item.name}
              onChange={(event) => patchLocal(item.id, { name: event.target.value })}
              onBlur={() => save({ ...item, updatedAt: new Date().toISOString() })}
            />
            <input
              className="field num"
              style={{ textAlign: "right" }}
              type="number"
              inputMode="decimal"
              aria-label="金额（U / USD）"
              value={item.amountUsd}
              onChange={(event) => patchLocal(item.id, { amountUsd: Number(event.target.value) })}
              onBlur={() => save({ ...item, updatedAt: new Date().toISOString() })}
            />
            <div className="right">
              <button type="button" className="btn-mini danger" onClick={() => remove(item.id)}>
                删除
              </button>
            </div>
            <div className="cell-sub" style={{ gridColumn: "1 / -1" }}>
              更新于 {timeAgo(item.updatedAt)}
            </div>
          </div>
        ))}
        {!items.length && (
          <div className="trow" style={{ gridTemplateColumns: "1fr" }}>
            <div className="empty">暂无手动资产，点击「+ 添加」记录</div>
          </div>
        )}
      </div>
      <div className="table-foot">
        <span>{saving ? "保存中…" : "修改后自动保存"}</span>
        <span>{items.length} 条记录</span>
      </div>
    </section>
  );
}
