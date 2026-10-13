/* One Tab stop per step grid; native buttons retain Space/Enter activation. */
(() => {
  window.BeatLabGrid = (rows, getStepCount) => {
    const emptyNavigation = { sync() {} };
    if (!Array.isArray(rows)) return emptyNavigation;

    const usableRows = rows
      .map((row, index) => (Array.isArray(row) && row.length ? index : -1))
      .filter((index) => index >= 0);
    if (!usableRows.length) return emptyNavigation;

    const grid = rows[usableRows[0]][0]?.closest?.(".grid");
    grid?.addEventListener("pointerdown", () => {
      grid.classList.remove("keyboard-navigation");
    });

    let position = { row: usableRows[0], column: 0 };
    const count = (rowIndex) => {
      const requested = Number(getStepCount());
      const visible = Number.isFinite(requested) ? Math.max(1, requested) : 1;
      return Math.min(rows[rowIndex].length, visible);
    };
    const nextUsableRow = (from, direction) => {
      for (
        let index = from + direction;
        index >= 0 && index < rows.length;
        index += direction
      ) {
        if (rows[index]?.length) return index;
      }
      return from;
    };
    function sync() {
      const active = document.activeElement;
      const previous = rows[position.row]?.[position.column];
      if (!rows[position.row]?.length) position.row = usableRows[0];
      position.column = Math.max(
        0,
        Math.min(count(position.row) - 1, position.column),
      );
      rows.forEach((row, rowIndex) =>
        row.forEach((button, columnIndex) => {
          button.tabIndex =
            rowIndex === position.row && columnIndex === position.column
              ? 0
              : -1;
        }),
      );
      const next = rows[position.row]?.[position.column];
      if (active === previous && previous !== next) next?.focus();
    }

    rows.forEach((row, rowIndex) =>
      row.forEach((button, columnIndex) => {
        button.addEventListener("focus", () => {
          position = { row: rowIndex, column: columnIndex };
          sync();
        });
        button.addEventListener("keydown", (event) => {
          const target = { ...position };
          if (event.key === "ArrowLeft") target.column--;
          else if (event.key === "ArrowRight") target.column++;
          else if (event.key === "ArrowUp")
            target.row = nextUsableRow(position.row, -1);
          else if (event.key === "ArrowDown")
            target.row = nextUsableRow(position.row, 1);
          else if (event.key === "PageUp") target.column -= 4;
          else if (event.key === "PageDown") target.column += 4;
          else if (event.key === "Home") {
            target.column = 0;
            if (event.ctrlKey || event.metaKey) target.row = usableRows[0];
          } else if (event.key === "End") {
            if (event.ctrlKey || event.metaKey)
              target.row = usableRows[usableRows.length - 1];
            target.column = count(target.row) - 1;
          } else return;

          event.preventDefault();
          grid?.classList.add("keyboard-navigation");
          target.column = Math.max(
            0,
            Math.min(count(target.row) - 1, target.column),
          );
          position = target;
          sync();
          rows[position.row]?.[position.column]?.focus();
        });
      }),
    );
    sync();
    return { sync };
  };
})();
