/* One Tab stop per step grid; native buttons retain Space/Enter activation. */
(() => {
  window.BeatLabGrid = (rows, getStepCount) => {
    let position = {row: 0, column: 0};
    const count = () => Math.max(1, Math.min(rows[0].length, getStepCount()));
    function sync() {
      const active = document.activeElement;
      const previous = rows[position.row][position.column];
      position.column = Math.min(position.column, count() - 1);
      rows.forEach((row, r) => row.forEach((button, c) => {
        button.tabIndex = r === position.row && c === position.column ? 0 : -1;
      }));
      if (active === previous && previous !== rows[position.row][position.column]) {
        rows[position.row][position.column].focus();
      }
    }
    rows.forEach((row, r) => row.forEach((button, c) => {
      button.addEventListener('focus', () => {
        position = {row: r, column: c};
        sync();
      });
      button.addEventListener('keydown', event => {
        let target = {...position};
        if (event.key === 'ArrowLeft') target.column--;
        else if (event.key === 'ArrowRight') target.column++;
        else if (event.key === 'ArrowUp') target.row--;
        else if (event.key === 'ArrowDown') target.row++;
        else if (event.key === 'Home') {
          target.column = 0;
          if (event.ctrlKey || event.metaKey) target.row = 0;
        } else if (event.key === 'End') {
          target.column = count() - 1;
          if (event.ctrlKey || event.metaKey) target.row = rows.length - 1;
        } else return;
        event.preventDefault();
        target.row = Math.max(0, Math.min(rows.length - 1, target.row));
        target.column = Math.max(0, Math.min(count() - 1, target.column));
        position = target;
        sync();
        rows[position.row][position.column].focus();
      });
    }));
    sync();
    return {sync};
  };
})();
