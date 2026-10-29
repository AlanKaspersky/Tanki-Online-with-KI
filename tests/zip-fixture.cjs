module.exports = function zipFixture(entries) {
    const local = [], directory = []; let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name), data = Buffer.from(entry.data || '');
        let crc = 0xffffffff;
        for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
        crc = (crc ^ 0xffffffff) >>> 0;
        const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
        header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
        local.push(header, name, data);
        const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x800, 8); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28); central.writeUInt32LE(((entry.mode || 0x81a4) << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
        directory.push(central, name); offset += header.length + name.length + data.length;
    }
    const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, central, end]);
};
