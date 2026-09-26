/** 零依赖 multipart/form-data 解析器（仅处理文件字段与普通字段） */

function indexOfBuf(haystack, needle, from = 0) {
  return haystack.indexOf(needle, from);
}

function readField(buf, start, end) {
  return buf.subarray(start, end).toString('utf8');
}

export function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw new Error('缺少 multipart boundary');
  const boundary = `--${(match[1] || match[2]).trim()}`;
  const boundaryBuf = Buffer.from(boundary);
  const CRLF = Buffer.from('\r\n');
  const HEADER_END = Buffer.from('\r\n\r\n');

  const body = {};
  const files = {};

  let pos = indexOfBuf(buffer, boundaryBuf);
  if (pos < 0) return { body, files };

  while (pos >= 0) {
    let cursor = pos + boundaryBuf.length;
    if (buffer[cursor] === 0x2d && buffer[cursor + 1] === 0x2d) break; // 结束标记 --
    // 跳过 CRLF
    if (buffer[cursor] === 0x0d && buffer[cursor + 1] === 0x0a) cursor += 2;
    const headerEnd = indexOfBuf(buffer, HEADER_END, cursor);
    if (headerEnd < 0) break;
    const headerText = readField(buffer, cursor, headerEnd);
    const partStart = headerEnd + HEADER_END.length;

    const nextBoundary = indexOfBuf(buffer, boundaryBuf, partStart);
    if (nextBoundary < 0) break;
    // 内容末尾的 CRLF 属于分隔符
    let partEnd = nextBoundary;
    if (buffer[partEnd - 2] === 0x0d && buffer[partEnd - 1] === 0x0a) partEnd -= 2;

    const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headerText)?.[1] || '';
    const nameMatch = /name="([^"]*)"/i.exec(disposition) || /name=([^;]+)/i.exec(disposition);
    const filenameMatch = /filename="([^"]*)"/i.exec(disposition) || /filename=([^;]+)/i.exec(disposition);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() || 'application/octet-stream';
    const name = nameMatch ? nameMatch[1].trim() : '';

    if (name) {
      if (filenameMatch) {
        const filename = filenameMatch[1].trim();
        if (filename) {
          files[name] = {
            filename,
            contentType: typeMatch,
            size: partEnd - partStart,
            data: buffer.subarray(partStart, partEnd),
          };
        } else {
          body[name] = '';
        }
      } else {
        const value = readField(buffer, partStart, partEnd);
        if (name in body) body[name] = Array.isArray(body[name]) ? [...body[name], value] : [body[name], value];
        else body[name] = value;
      }
    }

    pos = nextBoundary;
  }

  return { body, files };
}
