(() => {
  // Pointer Capture により、境界の外へドラッグしても操作を継続する。
  function bindResize(handle, start, update) {
    let drag = null;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || drag) return;
      event.preventDefault();
      event.stopPropagation();
      handle.focus();
      drag = { pointerId: event.pointerId, x: event.clientX, value: start() };
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add("is-resizing-width");
    });
    handle.addEventListener("pointermove", (event) => {
      if (drag?.pointerId !== event.pointerId) return;
      update(drag.value, event.clientX - drag.x);
    });
    const finish = (event) => {
      if (drag?.pointerId !== event.pointerId) return;
      drag = null;
      document.body.classList.remove("is-resizing-width");
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
      handle.addEventListener(event, finish);
    }
    // 列境界の操作で並べ替えやモーダルを閉じる処理を起動しない。
    handle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      update(start(), event.key === "ArrowRight" ? 10 : -10);
    });
  }

  function enableTable(table) {
    if (!table || table.dataset.resizable === "true") return;
    const headers = Array.from(table.tHead?.rows[0]?.cells || []);
    if (!headers.length) return;
    table.dataset.resizable = "true";
    let columns = null;
    let widths = null;

    function prepareWidths() {
      if (columns) return;
      // 非表示タブでは計測せず、最初の操作時に実際の表示幅を固定する。
      widths = headers.map((header) => header.getBoundingClientRect().width);
      const group = document.createElement("colgroup");
      columns = widths.map((width) => {
        const col = document.createElement("col");
        col.style.width = `${width}px`;
        group.appendChild(col);
        return col;
      });
      table.prepend(group);
      table.classList.add("is-column-resized");
      table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
    }

    headers.forEach((header, index) => {
      const handle = document.createElement("span");
      handle.className = "column-resize-handle";
      handle.tabIndex = 0;
      handle.setAttribute("role", "separator");
      handle.setAttribute("aria-orientation", "vertical");
      handle.setAttribute("aria-label", `${header.textContent.trim()}の列幅`);
      handle.setAttribute("aria-valuemin", "64");
      handle.setAttribute("aria-valuemax", "4000");
      handle.setAttribute("aria-valuenow", "64");
      handle.title = "ドラッグまたは左右キーで列幅を変更";
      header.appendChild(handle);
      handle.addEventListener("focus", () => {
        handle.setAttribute("aria-valuenow", String(Math.round(header.getBoundingClientRect().width)));
      });
      bindResize(handle, () => {
        prepareWidths();
        return widths[index];
      }, (startWidth, delta) => {
        widths[index] = Math.max(64, Math.min(4000, startWidth + delta));
        columns[index].style.width = `${widths[index]}px`;
        table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
        handle.setAttribute("aria-valuenow", String(Math.round(widths[index])));
      });
    });
  }

  function enableModal() {
    const modal = document.getElementById("star-culture-detail-modal");
    const frame = modal?.querySelector(".star-culture-modal-frame");
    const handle = modal?.querySelector(".modal-resize-handle");
    if (!frame || !handle) return;
    const maxWidth = () => {
      const style = getComputedStyle(modal);
      return modal.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    };
    const updateAria = () => {
      handle.setAttribute("aria-valuemin", String(Math.min(320, maxWidth())));
      handle.setAttribute("aria-valuemax", String(Math.round(maxWidth())));
      handle.setAttribute("aria-valuenow", String(Math.round(frame.getBoundingClientRect().width)));
    };
    handle.addEventListener("focus", updateAria);
    bindResize(handle, () => frame.getBoundingClientRect().width, (startWidth, delta) => {
      const max = maxWidth();
      // モーダルは中央配置なので、右端の移動量の2倍だけ幅を変更する。
      frame.style.width = `${Math.max(Math.min(320, max), Math.min(max, startWidth + delta * 2))}px`;
      updateAria();
    });
  }

  window.StarCultureResize = { enableTable };
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".star-culture-table").forEach(enableTable);
    enableModal();
  });
})();
