const $ = id => document.getElementById(id);
let selected = null, report = null, stream = null, overview = null;
const text = (id, value) => { $(id).textContent = value ?? ''; };
async function api(path, value) { const r = await fetch(path, value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); const data = await r.json(); if (!r.ok) throw new Error(data.error ?? '请求失败'); return data; }
function notify(error) { text('notice', error instanceof Error ? error.message : String(error)); }
function pre(value) { const el = document.createElement('pre'); el.textContent = JSON.stringify(value, null, 2); return el; }
function element(tag,value,cls) { const e=document.createElement(tag); if(value!==undefined)e.textContent=value; if(cls)e.className=cls; return e; }
const metricNames={net_sales:'净销售额',gross_sales:'正向销售额',returns:'退货金额',sales_orders:'销售订单数',identified_customers:'已识别客户数',avg_order_value:'客单价'};
function evidenceView(ev) {
  const el=element('div',undefined,'evidence-item');el.append(element('h3',`${metricNames[ev.result.metric]??ev.kind} · ${ev.kind==='comparison'?'期间比较':'变化贡献'}`));
  const request=ev.kind==='comparison'?ev.request:ev.request.comparison;
  el.append(element('p',`基期 ${request.baseline.start} 至 ${request.baseline.end} · 本期 ${request.current.start} 至 ${request.current.end}（结束日期不含）`,'muted'));
  if(ev.kind==='comparison') {
    const facts=element('div',undefined,'facts');for(const [label,key] of [['基期','baseline'],['本期','current'],['变化','delta']]){const f=element('div',undefined,'fact');f.append(element('span',`${label} · ${ev.result.unit}`),element('strong',ev.result[key]??'无定义'));facts.append(f);}el.append(facts);
  } else {
    const wrapper=element('div',undefined,'table-wrap'),table=element('table'),head=element('thead'),h=element('tr');for(const label of [ev.result.dimension==='country'?'国家':'商品','基期 GBP','本期 GBP','变化 GBP'])h.append(element('th',label));head.append(h);table.append(head);const body=element('tbody');
    const groups=[...ev.result.top];if(ev.result.other.groups)groups.push({dimension:`其他（${ev.result.other.groups} 组）`,...ev.result.other});groups.push({dimension:'合计',...ev.result.totals});
    for(const g of groups){const row=element('tr');for(const key of ['dimension','baseline','current','delta'])row.append(element('td',g[key]===null?'缺失值':g[key],key==='dimension'?'':'numeric'));body.append(row);}table.append(body);wrapper.append(table);el.append(wrapper,element('p','分组变化之和与总变化一致；此拆解不证明因果。','muted'));
  }
  const details=element('details'),summary=element('summary','查看请求、SQL、参数、版本和结果哈希');details.append(summary,pre(ev));el.append(details);return el;
}
function coverage() { const d = overview?.datasets.find(d => d.id === $('dataset').value); text('coverage', d ? `${Number(d.rows).toLocaleString()} 行 · ${d.min_time.slice(0,10)} — ${d.max_time.slice(0,10)}（最后一天不保证完整）` : '暂无数据。请先通过 CLI 导入 CSV。'); }
async function refresh() {
  overview = await api('/api/overview'); text('mode', overview.mode); text('catalog', JSON.stringify(overview.catalog, null, 2));
  const old = $('dataset').value; $('dataset').replaceChildren(...overview.datasets.map(d => { const o = document.createElement('option'); o.value = d.id; o.textContent = `${d.id.slice(0,15)}… · ${Number(d.rows).toLocaleString()} 行`; return o; })); if (overview.datasets.some(d => d.id === old)) $('dataset').value = old; coverage();
  $('start').disabled = !overview.datasets.length || overview.mode === 'inspection-only';
  $('jobs').replaceChildren(...overview.jobs.map(j => { const b = document.createElement('button'); b.className = `job-link${selected === j.id ? ' active' : ''}`; b.textContent = j.question.slice(0,70); const s = document.createElement('small'); s.textContent = `${j.status} · ${new Date(j.created).toLocaleString()}`; b.append(s); b.onclick = () => openJob(j.id).catch(notify); return b; }));
}
async function render() {
  if (!selected) return; const data = await api(`/api/jobs/${selected}`); const { job, evidence, events } = data; report = data.report;
  $('empty').hidden = true; $('detail').hidden = false; text('job-question', job.question); text('status', job.status); text('job-error', job.error);
  text('budget', `模型请求已预留 ${data.calls.length} / ${job.max_calls} · 单次输出上限 ${job.max_output} tokens · 未知尝试计入原额度`);
  const policies=events.filter(e=>e.kind==='context_prepared');
  const panel=$('context-policy');panel.replaceChildren();
  if(policies.length){const latest=policies.at(-1).payload;panel.append(element('h2','上下文与工具策略'));const facts=element('div',undefined,'facts');
    for(const [label,value] of [['整理前 JSON 字节',latest.beforeBytes],['整理后 JSON 字节',latest.afterBytes],['本轮工具 / 注册工具',`${latest.selectedToolNames.length} / ${latest.registeredTools}`]]){const f=element('div',undefined,'fact');f.append(element('span',label),element('strong',String(value)));facts.append(f);}panel.append(facts,element('p',`已暴露：${latest.selectedToolNames.join(' · ')}`,'muted'),element('p',`外置结果 ${latest.spilledResults.length} 项 · 归档历史 ${latest.archivedTurns.length} 轮。这里是上下文 JSON 字节，实际 token 见供应商 usage。`,'muted'));
    const usage=data.calls.filter(c=>c.usage).reduce((a,c)=>({input:a.input+c.usage.input+c.usage.cacheRead+c.usage.cacheWrite,output:a.output+c.usage.output,cost:a.cost+c.usage.cost.total}),{input:0,output:0,cost:0});panel.append(element('p',`本任务实际输入 ${usage.input} tokens · 输出 ${usage.output} tokens · 估计费用 $${usage.cost.toFixed(6)}（非账单）`,'muted'));
    const details=element('details'),summary=element('summary','逐请求策略记录');details.append(summary,pre(policies.map(e=>e.payload)));panel.append(details);panel.hidden=false;
  }else panel.hidden=true;
  $('cancel').hidden = ['completed','failed','cancelled','clarification'].includes(job.status); $('resume').hidden = !['paused','running','queued'].includes(job.status);
  $('events').replaceChildren(...events.slice(-70).map(ev => { const li = document.createElement('li'); const labels = { claimed:'取得任务写入权', model_reserved:'预留一次模型请求', tool_committed:'工具结果已持久化', report_sealed:'报告已封存', human_review:'人工审核已记录', clarification:'需要澄清', settled:'本轮结束', tool_execution_start:'开始执行工具', tool_execution_end:'工具执行完成', turn_end:'Pi 轮次结束' }; li.textContent = `${new Date(ev.created).toLocaleTimeString()} · ${labels[ev.kind] ?? ev.kind}${ev.payload.toolName ? ` · ${ev.payload.toolName}` : ''}`; if (ev.kind === 'clarification') li.textContent += `：${ev.payload.question}`; return li; }));
  $('report-card').hidden = !report; $('export').hidden = !report;
  if (report) { text('report-title', report.title); text('interpretation', report.interpretation); $('hypotheses').replaceChildren(...report.hypotheses.map(h => { const li = document.createElement('li'); li.textContent = h; return li; })); text('review-state', JSON.stringify(data.review ?? { status:'尚未人工审核' }, null, 2)); $('export').href = `/api/jobs/${selected}/export`; }
  $('evidence').replaceChildren(...evidence.slice().sort((a,b)=>a.kind==='comparison'?-1:b.kind==='comparison'?1:0).map(evidenceView));
}
async function openJob(id) { stream?.close(); selected = id; localStorage.setItem('metriclab-job', id); await render(); await refresh(); stream = new EventSource(`/api/jobs/${id}/events`); stream.onmessage = () => render().catch(notify); }
$('dataset').onchange = coverage;
$('new-job').onsubmit = async e => { e.preventDefault(); text('notice',''); try { const metric=$('intent-metric').value;const intent=metric?{metric,baseline:{start:$('baseline-start').value,end:$('baseline-end').value},current:{start:$('current-start').value,end:$('current-end').value},basis:$('intent-basis').value}:undefined;const j = await api('/api/jobs',{ dataset:$('dataset').value,question:$('question').value,max_calls:Number($('max-calls').value),max_output:Number($('max-output').value),...(intent?{intent}:{}) }); await openJob(j.id); } catch (error) { notify(error); } };
$('cancel').onclick = async () => { try { await api(`/api/jobs/${selected}/cancel`,{}); await render(); } catch(e) { notify(e); } };
$('resume').onclick = async () => { try { await api(`/api/jobs/${selected}/resume`,{}); await render(); } catch(e) { notify(e); } };
$('review').onsubmit = async e => { e.preventDefault(); try { await api(`/api/jobs/${selected}/review`,{report_id:report.id,decision:$('decision').value,note:$('review-note').value}); await render(); } catch(error) { notify(error); } };
void (async () => { try { await refresh(); const id = localStorage.getItem('metriclab-job'); if (id && overview.jobs.some(j => j.id === id)) await openJob(id); } catch(e) { notify(e); } })();
