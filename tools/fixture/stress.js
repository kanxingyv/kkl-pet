/** ?stress 时往页面塞一张 300 行 × 6 列的表格，用来压世界探测的预算。 */
if (new URLSearchParams(location.search).has("stress")) {
  const page = document.querySelector(".page");
  if (page) {
    const wrap = document.createElement("div");
    wrap.className = "stress-wrap";

    const head = document.createElement("h2");
    head.className = "stress-title";
    head.textContent = "压力表格 · 300 行 × 6 列";
    wrap.appendChild(head);

    const table = document.createElement("table");
    table.className = "stress-table";
    const tbody = document.createElement("tbody");
    const frag = document.createDocumentFragment();

    for (let r = 0; r < 300; r++) {
      const tr = document.createElement("tr");
      for (let c = 0; c < 6; c++) {
        const td = document.createElement("td");
        td.textContent = `R${r} C${c}`;
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }

    tbody.appendChild(frag);
    table.appendChild(tbody);
    wrap.appendChild(table);
    page.appendChild(wrap);
  }
}
