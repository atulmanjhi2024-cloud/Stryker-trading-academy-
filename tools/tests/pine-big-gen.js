// Builds a long, valid Pine v5 indicator (default ~2,200 lines / 130 KB) ending in a table.cell. Sample/test data only.
module.exports = function genBig(targetKB) {
  const L = ['//@version=5', 'indicator("EMA 9/21 cross (big test)", overlay=true, max_labels_count=100)'];
  const N = 30;
  for (let i = 1; i <= N; i++) L.push(`len${i} = input.int(${5 + i}, "Length ${i} (a long descriptive input title for padding)", minval=1, group="Group ${i % 5}", tooltip="Tooltip text for input number ${i}, padding padding padding")`);
  L.push('fast = ta.ema(close, 9)', 'slow = ta.ema(close, 21)', 'up = ta.crossover(fast, slow)', 'dn = ta.crossunder(fast, slow)');
  let k = 0;
  while (L.join('\n').length < targetKB * 1024 - 2500) {
    k++;
    const a = (k % N) + 1;
    L.push(`// block ${k}: smoothing with length ${a}, a comment that adds a little bulk`);
    L.push(`// second comment line for block ${k} to keep the line count high`);
    L.push(`m${k} = ta.sma(close, len${a}) + ${k} * 0.0 - ta.ema(close, len${a}) * 0.0`);
    L.push(`s${k} = math.abs(m${k} - nz(m${k}[1])) > 0 ? 1 : 0`);
  }
  L.push('plot(fast, "EMA 9", color=color.new(color.teal, 0), linewidth=2)', 'plot(slow, "EMA 21", color=color.new(color.orange, 0), linewidth=2)',
    'plotshape(up, "Cross up", style=shape.triangleup, location=location.belowbar, color=color.teal, size=size.tiny)',
    'plotshape(dn, "Cross down", style=shape.triangledown, location=location.abovebar, color=color.orange, size=size.tiny)',
    `var table t = table.new(position.top_right, 2, 2, border_width=1)`,
    `if barstate.islast`, `    table.cell(t, 0, 0, "Blocks", text_color=color.white)`, `    table.cell(t, 1, 0, "${k}", text_color=color.white)`,
    `    table.cell(t, 0, 1, "Cross", text_color=color.white)`, `    table.cell(t, 1, 1, up ? "up" : dn ? "down" : "none", text_color=color.white)`);
  return L.join('\n') + '\n';
};
