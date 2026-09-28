export function createStderrSink({ stream = process.stderr } = {}) {
  return (record) => {
    try {
      const serialized = JSON.stringify(record);
      if (typeof serialized !== 'string') return false;
      stream.write(`${serialized}\n`);
      return true;
    } catch {
      return false;
    }
  };
}
