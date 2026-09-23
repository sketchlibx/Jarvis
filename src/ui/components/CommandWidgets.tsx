import { useEffect, useState } from "react";
import type { WebSearchProvider } from "../../websearch/WebSearchProvider";

export type WidgetKind = "notepad" | "calendar" | "calculator" | "time" | "weather" | "news" | "search" | "timer";
interface Props { kind: WidgetKind; webSearch: WebSearchProvider; onClose: () => void; initialText?: string; initialCity?: string; initialSeconds?: number; }

function safeCalculate(expression: string): string {
  const normalized = expression.replace(/×/g, "*").replace(/÷/g, "/").replace(/[^0-9+\-*/%().\s]/g, "");
  if (!normalized.trim()) return "";
  if (/[^0-9+\-*/%().\s]/.test(normalized)) throw new Error("Unsupported expression");
  // Calculator widget is intentionally limited to arithmetic characters.
  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${normalized})`)();
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid result");
  return String(value);
}

export function CommandWidgets({ kind, webSearch, onClose, initialText, initialCity, initialSeconds }: Props) {
  return <section className="command-widget" aria-label={`${kind} widget`}>
    <header className="command-widget__header"><div><span className="command-widget__eyebrow">JARVIS WIDGET</span><h3>{titleFor(kind)}</h3></div><button onClick={onClose} aria-label="Close widget">×</button></header>
    <div className="command-widget__body">
      {kind === "notepad" && <Notepad initialText={initialText} />}
      {kind === "calendar" && <Calendar />}
      {kind === "calculator" && <Calculator />}
      {kind === "time" && <Time />}
      {kind === "weather" && <Weather initialCity={initialCity} />}
      {kind === "news" && <News webSearch={webSearch} />}
      {kind === "search" && <Search webSearch={webSearch} />}
      {kind === "timer" && <Timer initialSeconds={initialSeconds} />}
    </div>
  </section>;
}

function titleFor(kind: WidgetKind): string { return ({ notepad:"Notepad", calendar:"Calendar", calculator:"Calculator", time:"Time", weather:"Weather", news:"News", search:"Web Search", timer:"Timer" } as Record<WidgetKind,string>)[kind]; }

function Notepad({initialText}:{initialText?:string}) {
  const [text, setText] = useState(() => initialText ?? localStorage.getItem("jarvis.widget.notepad") ?? "");
  useEffect(() => { localStorage.setItem("jarvis.widget.notepad", text); }, [text]);
  return <div className="widget-stack"><textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note…"/><span className="widget-hint">Saved locally on this device.</span></div>;
}

function Calendar() {
  const [date, setDate] = useState(new Date());
  const [events, setEvents] = useState<Array<{date:string; title:string}>>(() => JSON.parse(localStorage.getItem("jarvis.widget.calendar") ?? "[]"));
  const [title, setTitle] = useState("");
  const key = date.toISOString().slice(0,10);
  const add = () => { if (!title.trim()) return; const next=[...events,{date:key,title:title.trim()}]; setEvents(next); localStorage.setItem("jarvis.widget.calendar",JSON.stringify(next)); setTitle(""); };
  const month = date.getMonth(); const year=date.getFullYear(); const first=new Date(year,month,1).getDay(); const days=new Date(year,month+1,0).getDate();
  return <div className="widget-calendar"><div className="calendar-nav"><button onClick={()=>setDate(new Date(year,month-1,1))}>‹</button><strong>{date.toLocaleString(undefined,{month:"long",year:"numeric"})}</strong><button onClick={()=>setDate(new Date(year,month+1,1))}>›</button></div><div className="calendar-grid">{["S","M","T","W","T","F","S"].map((d,i)=><b key={i}>{d}</b>)}{Array.from({length:first}).map((_,i)=><span key={`e${i}`}/>) }{Array.from({length:days},(_,i)=>i+1).map(d=>{const k=new Date(year,month,d).toISOString().slice(0,10);return <button key={d} className={k===key?"selected":""} onClick={()=>setDate(new Date(year,month,d))}>{d}</button>})}</div><div className="calendar-add"><input value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="Event / reminder"/><button onClick={add}>Add</button></div><div className="calendar-events">{events.filter(e=>e.date===key).map((e,i)=><div key={i}>{e.title}</div>)}{events.filter(e=>e.date===key).length===0&&<span className="widget-hint">No saved events for this day.</span>}</div></div>;
}

function Calculator(){ const [expr,setExpr]=useState(""); const [result,setResult]=useState(""); const run=()=>{try{setResult(safeCalculate(expr))}catch{setResult("Invalid expression")}}; return <div className="calculator"><div className="calculator-display">{result || expr || "0"}</div><input autoFocus value={expr} onChange={e=>setExpr(e.target.value)} onKeyDown={e=>e.key==="Enter"&&run()} placeholder="12 * 8 + 4"/><button onClick={run}>Calculate</button></div>; }
function Time(){ const [now,setNow]=useState(new Date()); useEffect(()=>{const id=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(id)},[]); return <div className="time-widget"><strong>{now.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"})}</strong><span>{now.toLocaleDateString([], {weekday:"long",day:"numeric",month:"long",year:"numeric"})}</span><small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small></div>; }
function Weather({initialCity}:{initialCity?:string}){ const [city,setCity]=useState(initialCity || localStorage.getItem("jarvis.widget.weatherCity") || "Delhi"); const [data,setData]=useState<any>(null); const [loading,setLoading]=useState(false); const load=async()=>{setLoading(true);try{localStorage.setItem("jarvis.widget.weatherCity",city);const g=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`).then(r=>r.json());const p=g.results?.[0];if(!p)throw new Error("City not found");const w=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`).then(r=>r.json());setData({place:`${p.name}, ${p.country}`,...w.current})}catch(e){setData({error:e instanceof Error?e.message:"Weather unavailable"})}finally{setLoading(false)}}; useEffect(()=>{void load()},[]);return <div className="weather-widget"><div className="widget-search"><input value={city} onChange={e=>setCity(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load()}/><button onClick={load}>{loading?"…":"Refresh"}</button></div>{data?.error?<span>{data.error}</span>:data&&<><strong>{Math.round(data.temperature_2m)}°C</strong><span>{data.place}</span><small>Humidity {data.relative_humidity_2m}% · Wind {Math.round(data.wind_speed_10m)} km/h</small></>}</div>; }
function News({webSearch}:{webSearch:WebSearchProvider}){const [items,setItems]=useState<Array<{title:string;url:string;snippet:string}>>([]);const [loading,setLoading]=useState(false);const load=async()=>{setLoading(true);try{const r=await webSearch.search("latest news today India technology world");setItems(r.results.slice(0,6))}catch{setItems([])}finally{setLoading(false)}};useEffect(()=>{void load()},[]);return <div className="news-widget"><button onClick={load}>{loading?"Loading…":"Refresh news"}</button>{items.map((x,i)=><a key={i} href={x.url} target="_blank" rel="noreferrer"><b>{x.title}</b><span>{x.snippet}</span></a>)}{!loading&&items.length===0&&<span className="widget-hint">Live news search is unavailable.</span>}</div>}
function Search({webSearch}:{webSearch:WebSearchProvider}){const [q,setQ]=useState("");const [items,setItems]=useState<any[]>([]);const run=async()=>{if(!q.trim())return;try{setItems((await webSearch.search(q)).results.slice(0,6))}catch{setItems([])}};return <div className="news-widget"><div className="widget-search"><input autoFocus value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&run()} placeholder="Search the web…"/><button onClick={run}>Search</button></div>{items.map((x,i)=><a key={i} href={x.url} target="_blank" rel="noreferrer"><b>{x.title}</b><span>{x.snippet}</span></a>)}</div>}
function Timer({initialSeconds}:{initialSeconds?:number}){const [seconds,setSeconds]=useState(initialSeconds ?? 60);const [running,setRunning]=useState(false);useEffect(()=>{if(!running)return;const id=setInterval(()=>setSeconds(s=>{if(s<=1){setRunning(false);return 0}return s-1}),1000);return()=>clearInterval(id)},[running]);return <div className="time-widget"><strong>{Math.floor(seconds/60).toString().padStart(2,"0")}:{(seconds%60).toString().padStart(2,"0")}</strong><div className="widget-search"><input type="number" min="1" value={seconds} onChange={e=>setSeconds(Math.max(1,Number(e.target.value)))} /><button onClick={()=>setRunning(v=>!v)}>{running?"Pause":"Start"}</button><button onClick={()=>{setRunning(false);setSeconds(60)}}>Reset</button></div></div>}
