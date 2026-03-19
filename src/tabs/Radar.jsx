// Loop Radar v2.0 — Integrated Trend Intelligence
// Uses same score engine (calcScore), categories, and ideal slots as the rest of Loop Manager
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { CAT_COLORS, CAT_EMOJI, ALL_CATS, fmt } from "../data/constants.js";
import { calcScore } from "../engine/score.js";

// ─── Config ──────────────────────────────────────────────────────────
const HORIZONS = {
  H1: { label: "Ação Imediata", sub: "0-30d · Brás/25 de Março", color: "#d63031", bg: "#ffeaea", freq: "Semanal" },
  H2: { label: "Pipeline", sub: "30-90d · Sample Alibaba", color: "#e17055", bg: "#fff3e0", freq: "Quinzenal" },
  H3: { label: "Watchlist", sub: "90-180d · Monitorar", color: "#0984e3", bg: "#e8f4fd", freq: "Mensal" }
};

const SCAN_QUERIES = {
  H1: [
    { src: "TikTok Viral (curadoria)", q: "produtos virais tiktok 2026 compra impulso variedades" },
    { src: "Amazon Trending BR", q: "amazon mais vendidos papelaria beauty acessórios brasil 2026" },
    { src: "Tendências varejo impulso", q: "trending impulse retail products 2026 stationery beauty accessories" }
  ],
  H2: [
    { src: "AliExpress Hot", q: "aliexpress trending products kawaii stationery beauty 2026" },
    { src: "Etsy Tendências", q: "etsy trending handmade accessories home fragrance 2026" },
    { src: "Blogs de tendência", q: "retail trend forecast 2026 impulse buy variety store products" }
  ],
  H3: [
    { src: "Flying Tiger novidades", q: "flying tiger copenhagen new products collection 2026" },
    { src: "Miniso lançamentos", q: "miniso new product launches global 2026" },
    { src: "Feiras internacionais", q: "canton fair hong kong gifts fair trending products 2026 variety store" }
  ]
};

const STATUSES = ["CANDIDATO", "TESTE", "APROVADO", "WATCHLIST", "DESCARTA"];

const genId = () => Math.random().toString(36).substr(2, 9);
const today = () => new Date().toISOString().split("T")[0];

// ─── API Helper ──────────────────────────────────────────────────────
async function callAPI(system, userMsg, useWebSearch = false) {
  try {
    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: userMsg }]
    };
    if (useWebSearch) {
      body.tools = [{ type: "web_search_20250305", name: "web_search" }];
    }
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const texts = (data.content || []).filter(b => b.type === "text").map(b => b.text);
    return texts.join("\n");
  } catch (e) {
    console.error("Radar API error:", e);
    return null;
  }
}

function parseJSON(raw) {
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (match) return JSON.parse(match[0]);
  } catch (e) { console.error("JSON parse error:", e); }
  return null;
}

// ─── Scan System Prompt ──────────────────────────────────────────────
function buildScanPrompt(skus, idealSlots, horizon) {
  const existingProducts = skus.map(s => s.n).join(", ");
  const openSlots = (idealSlots || [])
    .filter(s => s.status === "open")
    .slice(0, 20)
    .map(s => `${s.n} (${s.c}, R$${s.pv})`)
    .join("; ");

  return `Você é o Loop Radar — sistema de inteligência de tendências para o quiosque LOOP.
LOOP: quiosque 9m², Shopping Nova América RJ, público B/C, preço R$5-50, compra de impulso.
Categorias: ${ALL_CATS.join(", ")}.

SORTIMENTO ATUAL (${skus.length} SKUs): ${existingProducts.slice(0, 500)}...

SLOTS ABERTOS NO SORTIMENTO IDEAL: ${openSlots || "Nenhum informado"}

HORIZONTE: ${horizon} — ${HORIZONS[horizon].sub}

TAREFA: Usando web search, encontre 4-6 produtos ESPECÍFICOS em tendência que seriam adequados para o quiosque LOOP. 
Para cada produto, retorne APENAS um JSON array (sem markdown, sem backticks, sem texto antes ou depois):
[{
  "name": "nome em português",
  "category": "uma das 14 categorias Loop",
  "priceEstBRL": número (preço de venda estimado),
  "costEstBRL": número (custo estimado),
  "trendSignal": "1 frase sobre por que está em tendência",
  "growthRate": "alta|média|moderada",
  "source": "onde foi identificado",
  "saturationRisk": "baixo|médio|alto",
  "searchTerm": "termo para buscar fornecedor no Alibaba/Brás",
  "fitsIdealSlot": "nome do slot que preenche ou NENHUM",
  "dims": {"l": cm, "w": cm, "h": cm}
}]

REGRAS:
- Produtos CONCRETOS (não categorias genéricas)
- NÃO repetir produtos que já existem no sortimento atual
- Priorizar produtos que preencham slots abertos do sortimento ideal
- Faixa de preço R$5-50 obrigatória
- Margem estimada ≥ 40%
- Perfil de impulso: compra em menos de 30 segundos`;
}

function buildScorePrompt() {
  return `Você avalia produtos candidatos para o quiosque LOOP (9m², impulso, B/C).
Avalie em 6 dimensões (0-10 cada):
1. FIT_IMPULSO: compra <30s? visual atrativo?
2. FIT_PRECO: R$5-50? mais perto de R$10-20 = melhor
3. MARGEM: ≥40%? quanto maior melhor
4. SOURCING: fácil no Brás/Alibaba? MOQ baixo?
5. CROSS_SELL: complementa sortimento? atende múltiplos perfis?
6. TIMING: tendência crescendo ou já saturou?

Retorne APENAS JSON (sem markdown):
{"scores":{"fit_impulso":N,"fit_preco":N,"margem":N,"sourcing":N,"cross_sell":N,"timing":N},"totalScore":N,"reasoning":"1 frase","suggestedAction":"ação concreta"}`;
}

// ─── Sub-components ──────────────────────────────────────────────────

function StatusPill({ status, onClick }) {
  const colors = {
    CANDIDATO: "#00b894", TESTE: "#0984e3", APROVADO: "#00b894",
    WATCHLIST: "#fdcb6e", DESCARTA: "#d63031", PENDENTE: "#636e72"
  };
  const c = colors[status] || colors.PENDENTE;
  return (
    <span onClick={onClick} style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 10,
      fontSize: 10, fontWeight: 700, background: c + "20", color: c,
      border: `1.5px solid ${c}`, cursor: onClick ? "pointer" : "default"
    }}>{status}</span>
  );
}

function MiniScore({ score, max = 10 }) {
  const pct = Math.min((score / max) * 100, 100);
  const c = score >= 7 ? "#00b894" : score >= 5 ? "#fdcb6e" : "#d63031";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 5, background: "#eee", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: c, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: c, minWidth: 24 }}>{score.toFixed(1)}</span>
    </div>
  );
}

function CandidateCard({ item, onStatus, onRescore, onSendToEvaluator, loading }) {
  const [open, setOpen] = useState(false);
  const h = HORIZONS[item.horizon] || HORIZONS.H2;
  const margin = item.priceEstBRL && item.costEstBRL
    ? ((1 - item.costEstBRL / item.priceEstBRL) * 100).toFixed(0) : "?";

  // Compute Loop Score if we have enough data
  const loopScore = useMemo(() => {
    if (!item.priceEstBRL || !item.costEstBRL || !item.category) return null;
    const dims = item.dims || { l: 10, w: 5, h: 5 };
    return calcScore(item.priceEstBRL, item.costEstBRL, 24, dims, item.category);
  }, [item.priceEstBRL, item.costEstBRL, item.category, item.dims]);

  return (
    <div style={{
      background: "#fff", borderRadius: 10, padding: "14px 16px", marginBottom: 8,
      border: "1px solid #f0f0f0", cursor: "pointer", transition: "box-shadow 0.2s"
    }}
      onClick={() => setOpen(!open)}
      onMouseEnter={e => e.currentTarget.style.boxShadow = "0 3px 10px rgba(0,0,0,0.06)"}
      onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
    >
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#2d3436" }}>{item.name}</span>
            <StatusPill status={item.status || "PENDENTE"} />
            <span style={{
              fontSize: 10, padding: "1px 7px", borderRadius: 6,
              background: h.bg, color: h.color, fontWeight: 600
            }}>{item.horizon}</span>
          </div>
          <div style={{ display: "flex", gap: 10, fontSize: 11, color: "#999", marginTop: 3, flexWrap: "wrap" }}>
            <span style={{ background: (CAT_COLORS[item.category] || "#999") + "20", color: CAT_COLORS[item.category] || "#999", padding: "0 6px", borderRadius: 6, fontWeight: 600 }}>
              {CAT_EMOJI[item.category] || "📦"} {item.category}
            </span>
            <span>R${item.priceEstBRL}</span>
            <span style={{ color: parseFloat(margin) >= 40 ? "#00b894" : "#d63031" }}>Mg {margin}%</span>
            {item.fitsIdealSlot && item.fitsIdealSlot !== "NENHUM" && (
              <span style={{ background: "#dfe6e9", padding: "0 6px", borderRadius: 6, fontWeight: 600 }}>🎯 {item.fitsIdealSlot}</span>
            )}
          </div>
        </div>
        {/* Right: scores */}
        <div style={{ minWidth: 90, textAlign: "right" }}>
          {item.radarScore != null && <MiniScore score={item.radarScore} />}
          {loopScore && (
            <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>
              Loop: {loopScore.score.toFixed(1)} · <span style={{ color: REC_COLORS[loopScore.rec] || "#999" }}>{loopScore.rec}</span>
            </div>
          )}
        </div>
      </div>

      {item.trendSignal && (
        <p style={{ fontSize: 11, color: "#636e72", margin: "5px 0 0", lineHeight: 1.3 }}>📡 {item.trendSignal}</p>
      )}

      {/* Expanded detail */}
      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>
          {/* Radar scores */}
          {item.scores && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px 14px", marginBottom: 10 }}>
              {Object.entries(item.scores).map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 9, color: "#b2bec3", textTransform: "uppercase", letterSpacing: 0.5 }}>{k.replace(/_/g, " ")}</div>
                  <MiniScore score={v} />
                </div>
              ))}
            </div>
          )}

          {/* Loop Score detail */}
          {loopScore && (
            <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>📊 Score Loop v11 (estimado)</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, fontSize: 11 }}>
                <div><span style={{ color: "#999" }}>Score:</span> <b>{loopScore.score.toFixed(2)}</b></div>
                <div><span style={{ color: "#999" }}>Demanda:</span> <b>{loopScore.demanda.toFixed(0)} pcs</b></div>
                <div><span style={{ color: "#999" }}>Receita:</span> <b>{fmt(loopScore.receitaMes)}/m</b></div>
                <div><span style={{ color: "#999" }}>Lucro:</span> <b>{fmt(loopScore.lucroMes)}/m</b></div>
              </div>
              <div style={{ fontSize: 11, marginTop: 4 }}>
                <span style={{ color: "#999" }}>Rec:</span>{" "}
                <span style={{ color: REC_COLORS[loopScore.rec], fontWeight: 700 }}>{loopScore.rec}</span>
                {loopScore.pOtimo && <span style={{ color: "#999", marginLeft: 8 }}>P.Ótimo: R${loopScore.pOtimo.toFixed(0)}</span>}
              </div>
            </div>
          )}

          {item.reasoning && <p style={{ fontSize: 11, color: "#636e72", margin: "6px 0", fontStyle: "italic" }}>💡 {item.reasoning}</p>}
          {item.suggestedAction && <p style={{ fontSize: 11, color: "#0984e3", margin: "4px 0", fontWeight: 600 }}>→ {item.suggestedAction}</p>}

          {/* Actions */}
          <div style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
            {STATUSES.map(s => (
              <button key={s} onClick={e => { e.stopPropagation(); onStatus(item.id, s); }}
                style={{
                  padding: "4px 10px", borderRadius: 8, fontSize: 10, fontWeight: 700,
                  border: item.status === s ? "2px solid #2d3436" : "1px solid #ddd",
                  background: item.status === s ? "#2d3436" : "#fff",
                  color: item.status === s ? "#fff" : "#666", cursor: "pointer"
                }}>{s}</button>
            ))}
            <button onClick={e => { e.stopPropagation(); onRescore(item.id); }}
              disabled={loading}
              style={{
                padding: "4px 10px", borderRadius: 8, fontSize: 10, fontWeight: 700,
                border: "1px solid #6C5CE7", background: "#f3f0ff", color: "#6C5CE7",
                cursor: loading ? "wait" : "pointer", marginLeft: "auto"
              }}>{loading ? "..." : "⟳ Re-score"}</button>
            <button onClick={e => { e.stopPropagation(); onSendToEvaluator(item); }}
              style={{
                padding: "4px 10px", borderRadius: 8, fontSize: 10, fontWeight: 700,
                border: "1px solid #E84393", background: "#fce4ec", color: "#E84393", cursor: "pointer"
              }}>🤖 Avaliar com AI</button>
          </div>
          <div style={{ fontSize: 9, color: "#b2bec3", marginTop: 6 }}>
            Fonte: {item.source} · Detectado: {item.detectedDate} · Saturação: {item.saturationRisk}
            {item.searchTerm && <> · Busca: "{item.searchTerm}"</>}
          </div>
        </div>
      )}
    </div>
  );
}

const REC_COLORS = { "AMPLIAR": "#00b894", "MANTER": "#0984e3", "REVISAR": "#fdcb6e", "CORTAR": "#d63031" };

// ─── Main Radar Component ────────────────────────────────────────────
export default function Radar({ skus, idealSlots, onSendToEvaluator }) {
  const [candidates, setCandidates] = useState(() => {
    try { return JSON.parse(localStorage.getItem("loop_radar") || "[]"); } catch { return []; }
  });
  const [scanLog, setScanLog] = useState([]);
  const [loading, setLoading] = useState({});
  const [subTab, setSubTab] = useState("pipeline");
  const [filterH, setFilterH] = useState("ALL");
  const [filterS, setFilterS] = useState("ALL");
  const [manualName, setManualName] = useState("");
  const [manualCat, setManualCat] = useState("Papelaria");
  const [manualPrice, setManualPrice] = useState("");
  const [manualCost, setManualCost] = useState("");

  // Persist
  useEffect(() => {
    try { localStorage.setItem("loop_radar", JSON.stringify(candidates)); } catch {}
  }, [candidates]);

  const log = (msg) => setScanLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 80));

  // ─── Scan ────────────────────────────────────────────────────────
  const runScan = async (horizon) => {
    setLoading(prev => ({ ...prev, [horizon]: true }));
    log(`🔄 Varredura ${horizon} iniciada...`);

    const queries = SCAN_QUERIES[horizon];
    let allProducts = [];

    for (const { src, q } of queries) {
      log(`📡 ${src}...`);
      const sysPrompt = buildScanPrompt(skus, idealSlots, horizon);
      const raw = await callAPI(sysPrompt, `Busque na web: "${q}" e identifique 4-6 produtos específicos adequados para o quiosque LOOP.`, true);
      const products = parseJSON(raw);
      if (Array.isArray(products) && products.length > 0) {
        log(`✅ ${src}: ${products.length} produtos`);
        allProducts.push(...products.map(p => ({ ...p, source: src })));
      } else {
        log(`⚠️ ${src}: sem resultados`);
      }
    }

    // Score each
    log(`🧮 Avaliando ${allProducts.length} candidatos...`);
    const scored = [];
    for (const p of allProducts) {
      const scoreRaw = await callAPI(
        buildScorePrompt(),
        `Produto: ${p.name} | Categoria: ${p.category} | PV: R$${p.priceEstBRL} | Custo: R$${p.costEstBRL} | Tendência: ${p.trendSignal} | Saturação: ${p.saturationRisk}`,
        false
      );
      const scoreData = parseJSON(scoreRaw) || {};
      scored.push({
        id: genId(), ...p, ...scoreData,
        radarScore: scoreData.totalScore || null,
        status: (scoreData.totalScore || 0) >= 7 ? "CANDIDATO" : (scoreData.totalScore || 0) >= 5 ? "WATCHLIST" : "DESCARTA",
        detectedDate: today(), horizon
      });
    }

    // Merge avoiding dupes
    setCandidates(prev => {
      const names = new Set(prev.map(c => c.name?.toLowerCase()));
      const newOnes = scored.filter(s => s.name && !names.has(s.name.toLowerCase()));
      log(`✅ ${horizon} completo: ${newOnes.length} novos de ${scored.length} avaliados`);
      return [...newOnes, ...prev];
    });

    setLoading(prev => ({ ...prev, [horizon]: false }));
  };

  const runFullScan = async () => {
    for (const h of ["H1", "H2", "H3"]) await runScan(h);
  };

  // ─── Manual analysis ────────────────────────────────────────────
  const analyzeManual = async () => {
    if (!manualName.trim()) return;
    setLoading(prev => ({ ...prev, manual: true }));
    log(`🔍 Análise manual: ${manualName}`);

    // Enrich with web search
    const enrichRaw = await callAPI(
      `Pesquise o produto para varejo de impulso no Brasil. Retorne APENAS JSON: {"priceEstBRL":N,"costEstBRL":N,"trendSignal":"...","growthRate":"...","saturationRisk":"...","searchTerm":"...","dims":{"l":N,"w":N,"h":N}}`,
      `Produto: "${manualName}", Categoria: ${manualCat}. Encontre preço de venda estimado no Brasil, custo de fornecedor, e se está em tendência.`,
      true
    );
    const enrichData = parseJSON(enrichRaw) || {};

    const product = {
      name: manualName.trim(),
      category: manualCat,
      priceEstBRL: parseFloat(manualPrice) || enrichData.priceEstBRL || 20,
      costEstBRL: parseFloat(manualCost) || enrichData.costEstBRL || 5,
      trendSignal: enrichData.trendSignal || "Análise manual",
      growthRate: enrichData.growthRate || "desconhecido",
      saturationRisk: enrichData.saturationRisk || "médio",
      searchTerm: enrichData.searchTerm || manualName,
      dims: enrichData.dims || { l: 10, w: 5, h: 5 },
      source: "Input manual",
      fitsIdealSlot: "NENHUM"
    };

    // Score
    const scoreRaw = await callAPI(
      buildScorePrompt(),
      `Produto: ${product.name} | Categoria: ${product.category} | PV: R$${product.priceEstBRL} | Custo: R$${product.costEstBRL} | Tendência: ${product.trendSignal}`,
      false
    );
    const scoreData = parseJSON(scoreRaw) || {};

    const candidate = {
      id: genId(), ...product, ...scoreData,
      radarScore: scoreData.totalScore || null,
      status: "CANDIDATO",
      detectedDate: today(),
      horizon: "H1"
    };

    setCandidates(prev => [candidate, ...prev]);
    log(`✅ ${manualName}: Score ${candidate.radarScore || "?"}`);
    setManualName(""); setManualPrice(""); setManualCost("");
    setLoading(prev => ({ ...prev, manual: false }));
  };

  // ─── Actions ─────────────────────────────────────────────────────
  const updateStatus = (id, newStatus) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c));
  };

  const rescore = async (id) => {
    setLoading(prev => ({ ...prev, [id]: true }));
    const item = candidates.find(c => c.id === id);
    if (!item) return;
    const raw = await callAPI(
      buildScorePrompt(),
      `Produto: ${item.name} | Categoria: ${item.category} | PV: R$${item.priceEstBRL} | Custo: R$${item.costEstBRL} | Tendência: ${item.trendSignal}`,
      false
    );
    const data = parseJSON(raw);
    if (data) {
      setCandidates(prev => prev.map(c => c.id === id ? { ...c, ...data, radarScore: data.totalScore } : c));
    }
    setLoading(prev => ({ ...prev, [id]: false }));
  };

  const clearAll = () => { setCandidates([]); setScanLog([]); };

  // ─── Filtering & sorting ────────────────────────────────────────
  const filtered = useMemo(() => {
    return candidates
      .filter(c => filterH === "ALL" || c.horizon === filterH)
      .filter(c => filterS === "ALL" || c.status === filterS)
      .sort((a, b) => {
        const ord = { CANDIDATO: 0, TESTE: 1, WATCHLIST: 2, APROVADO: 3, DESCARTA: 5 };
        const oA = ord[a.status] ?? 4, oB = ord[b.status] ?? 4;
        if (oA !== oB) return oA - oB;
        return (b.radarScore || 0) - (a.radarScore || 0);
      });
  }, [candidates, filterH, filterS]);

  // ─── Stats ───────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const s = { total: candidates.length, CANDIDATO: 0, TESTE: 0, APROVADO: 0, WATCHLIST: 0, DESCARTA: 0, H1: 0, H2: 0, H3: 0 };
    candidates.forEach(c => { if (s[c.status] != null) s[c.status]++; if (s[c.horizon] != null) s[c.horizon]++; });
    return s;
  }, [candidates]);

  // ─── Render ──────────────────────────────────────────────────────
  const sty = {
    card: { background: "#fff", borderRadius: 12, padding: 16, border: "1px solid #f0f0f0" },
    btn: (active, color = "#2d3436") => ({
      padding: "5px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
      border: active ? `2px solid ${color}` : "1px solid #e0e0e0",
      background: active ? color : "#fff", color: active ? "#fff" : "#888", transition: "all 0.15s"
    }),
    input: { padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e0e0e0", fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" }
  };

  const isAnyLoading = Object.values(loading).some(v => v);

  return (
    <div>
      {/* Stats bar */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {[
          { l: "Total", v: stats.total, c: "#2d3436" },
          { l: "Candidatos", v: stats.CANDIDATO, c: "#00b894" },
          { l: "Teste", v: stats.TESTE, c: "#0984e3" },
          { l: "Aprovados", v: stats.APROVADO, c: "#00b894" },
          { l: "Watchlist", v: stats.WATCHLIST, c: "#fdcb6e" },
          { l: "H1", v: stats.H1, c: HORIZONS.H1.color },
          { l: "H2", v: stats.H2, c: HORIZONS.H2.color },
          { l: "H3", v: stats.H3, c: HORIZONS.H3.color },
        ].map(s => (
          <div key={s.l} style={{ background: "#fff", borderRadius: 8, padding: "5px 10px", border: "1px solid #f0f0f0", textAlign: "center", minWidth: 52 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: s.c }}>{s.v}</div>
            <div style={{ fontSize: 9, color: "#b2bec3", fontWeight: 600 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 3, marginBottom: 12 }}>
        {[
          { id: "pipeline", label: "📊 Pipeline" },
          { id: "scan", label: "📡 Varredura" },
          { id: "manual", label: "✏️ Manual" },
          { id: "log", label: "📋 Log" }
        ].map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)} style={sty.btn(subTab === t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ─── PIPELINE ─── */}
      {subTab === "pipeline" && (
        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
            {["ALL", "H1", "H2", "H3"].map(h => (
              <button key={h} onClick={() => setFilterH(h)} style={sty.btn(filterH === h, HORIZONS[h]?.color)}>
                {h === "ALL" ? "Todos" : h}
              </button>
            ))}
            <div style={{ width: 8 }} />
            {["ALL", ...STATUSES].map(s => (
              <button key={s} onClick={() => setFilterS(s)} style={sty.btn(filterS === s)}>
                {s === "ALL" ? "Todos" : s}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div style={{ ...sty.card, textAlign: "center", padding: 40, color: "#b2bec3" }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📡</div>
              <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Pipeline vazio</p>
              <p style={{ fontSize: 12, margin: "4px 0 0" }}>Execute uma varredura ou adicione produtos manualmente</p>
            </div>
          ) : (
            filtered.map(item => (
              <CandidateCard key={item.id} item={item}
                onStatus={updateStatus} onRescore={rescore}
                onSendToEvaluator={onSendToEvaluator}
                loading={!!loading[item.id]} />
            ))
          )}
        </div>
      )}

      {/* ─── SCAN ─── */}
      {subTab === "scan" && (
        <div>
          <div style={{ ...sty.card, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>🚀 Varredura Completa</div>
                <div style={{ fontSize: 11, color: "#999" }}>Executa H1 + H2 + H3 sequencialmente com web search + scoring</div>
              </div>
              <button onClick={runFullScan} disabled={isAnyLoading}
                style={{
                  padding: "8px 18px", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 12,
                  background: isAnyLoading ? "#ddd" : "linear-gradient(135deg, #6C5CE7, #E84393)",
                  color: "#fff", cursor: isAnyLoading ? "wait" : "pointer"
                }}>{isAnyLoading ? "Varrendo..." : "Iniciar Varredura"}</button>
            </div>
          </div>

          {Object.entries(HORIZONS).map(([key, cfg]) => (
            <div key={key} style={{
              ...sty.card, marginBottom: 8, borderLeft: `4px solid ${cfg.color}`
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{key} — {cfg.label}</div>
                  <div style={{ fontSize: 11, color: "#999" }}>{cfg.sub} · Frequência: {cfg.freq}</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                    {SCAN_QUERIES[key].map(s => (
                      <span key={s.src} style={{ fontSize: 9, background: cfg.bg, color: cfg.color, padding: "1px 6px", borderRadius: 5, fontWeight: 600 }}>{s.src}</span>
                    ))}
                  </div>
                </div>
                <button onClick={() => runScan(key)} disabled={!!loading[key]}
                  style={{
                    padding: "6px 14px", borderRadius: 8, border: `1.5px solid ${cfg.color}`,
                    background: loading[key] ? "#f5f5f5" : "#fff", color: cfg.color,
                    fontSize: 11, fontWeight: 700, cursor: loading[key] ? "wait" : "pointer"
                  }}>{loading[key] ? "Varrendo..." : `Varrer ${key}`}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── MANUAL ─── */}
      {subTab === "manual" && (
        <div>
          <div style={sty.card}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>✏️ Análise Manual</div>
            <p style={{ fontSize: 12, color: "#999", margin: "0 0 12px" }}>
              Viu algo no TikTok, Instagram ou Brás? O Radar pesquisa na web, estima preço/margem, calcula Score Loop, e classifica.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: 2, minWidth: 160 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#999", marginBottom: 3 }}>Produto</div>
                <input value={manualName} onChange={e => setManualName(e.target.value)}
                  placeholder="Ex: Lip Tint Coreano, Squishy Banana..." style={sty.input}
                  onKeyDown={e => e.key === "Enter" && analyzeManual()} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#999", marginBottom: 3 }}>Categoria</div>
                <select value={manualCat} onChange={e => setManualCat(e.target.value)}
                  style={{ ...sty.input, background: "#fff" }}>
                  {ALL_CATS.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ minWidth: 80 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#999", marginBottom: 3 }}>PV est.</div>
                <input value={manualPrice} onChange={e => setManualPrice(e.target.value)}
                  placeholder="R$" type="number" style={sty.input} />
              </div>
              <div style={{ minWidth: 80 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#999", marginBottom: 3 }}>Custo est.</div>
                <input value={manualCost} onChange={e => setManualCost(e.target.value)}
                  placeholder="R$" type="number" style={sty.input} />
              </div>
              <button onClick={analyzeManual} disabled={!!loading.manual}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 12,
                  background: loading.manual ? "#ddd" : "linear-gradient(135deg, #6C5CE7, #E84393)",
                  color: "#fff", cursor: loading.manual ? "wait" : "pointer", whiteSpace: "nowrap"
                }}>{loading.manual ? "Analisando..." : "🔍 Analisar"}</button>
            </div>
          </div>

          <div style={{ ...sty.card, marginTop: 10, background: "#f8f9fa" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>💡 Como usar</div>
            <div style={{ fontSize: 12, color: "#636e72", lineHeight: 1.6 }}>
              <p style={{ margin: "0 0 4px" }}><b>Scrollando TikTok</b> e viu um produto? Jogue o nome aqui. O Radar pesquisa, calcula o Score Loop real (mesmo motor do sortimento), e diz se vale testar.</p>
              <p style={{ margin: "0 0 4px" }}><b>Visitou o Brás</b>? Registre o produto com custo real e o sistema avalia se cabe no sortimento ideal.</p>
              <p style={{ margin: 0 }}><b>Candidato aprovado?</b> Clique "🤖 Avaliar com AI" para enviar à aba Avaliar Produto com foto e análise completa.</p>
            </div>
          </div>
        </div>
      )}

      {/* ─── LOG ─── */}
      {subTab === "log" && (
        <div>
          <div style={{
            background: "#2d3436", borderRadius: 10, padding: 14,
            fontFamily: "monospace", maxHeight: 400, overflowY: "auto"
          }}>
            {scanLog.length === 0 ? (
              <div style={{ color: "#636e72", fontSize: 12, textAlign: "center", padding: 24 }}>
                Nenhum log. Execute uma varredura.
              </div>
            ) : scanLog.map((line, i) => (
              <div key={i} style={{
                color: line.includes("❌") ? "#d63031" : line.includes("✅") ? "#00b894" : line.includes("⚠️") ? "#fdcb6e" : "#b2bec3",
                fontSize: 11, padding: "2px 0", borderBottom: "1px solid #3a3f42"
              }}>{line}</div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button onClick={() => setScanLog([])} style={sty.btn(false)}>Limpar Log</button>
            <button onClick={clearAll}
              style={{ ...sty.btn(false, "#d63031"), borderColor: "#d63031", color: "#d63031" }}>
              ⚠️ Resetar Radar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
