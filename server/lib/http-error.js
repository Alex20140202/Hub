/** 统一错误类型：抛出后由顶层错误处理器转成 JSON */
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.extra = extra;
  }
  static badRequest(msg = '请求参数有误', extra) {
    return new HttpError(400, msg, extra);
  }
  static unauthorized(msg = '请先登录') {
    return new HttpError(401, msg);
  }
  static forbidden(msg = '没有权限执行该操作') {
    return new HttpError(403, msg);
  }
  static notFound(msg = '资源不存在') {
    return new HttpError(404, msg);
  }
  static conflict(msg = '资源已存在') {
    return new HttpError(409, msg);
  }
  static tooLarge(msg = '请求体过大') {
    return new HttpError(413, msg);
  }
  static tooMany(msg = '操作过于频繁，请稍后再试') {
    return new HttpError(429, msg);
  }
}

export default HttpError;
