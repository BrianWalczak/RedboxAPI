const crypto = require('crypto');
const encMethod = {
    customer: { // Redbox Customer login (found in Redbox.Core.ByteArrayExtensions > ByteArrayExtensions.Encrypt)
        keyValue: '{776DA6AF-3033-43ee-B379-2D4F28B5F1FC}',
        initialVector: '{F375D7E0-4572-4518-9C2F-E8F022F42AA7}'
    },
    local: { // Redbox Desktop + Field Maintenance (found in Redbox.Rental.Services.Authentication > EncryptionHelper.Encrypt)
        keyValue: '{02CAD7C4-E0F5-4b1b-BD04-808B840A61D2}',
        initialVector: '{AD186FCD-2ACD-41a8-958D-6CA7DAEB1DE5}'
    }
};

function guidToByteArray(guidStr) {
    const hex = guidStr.replace(/[{}-]/g, '');
    const bytes = Buffer.from(hex, 'hex');

    // little-endian format
    return Buffer.concat([
        Buffer.from([bytes[3], bytes[2], bytes[1], bytes[0]]),
        Buffer.from([bytes[5], bytes[4]]),
        Buffer.from([bytes[7], bytes[6]]),
        bytes.slice(8)
    ]);
}

function encrypt(data, method) {
    if (data == null) return null;

    try {
        // guid to byte arr
        const m_keyValueBase = guidToByteArray(method.keyValue);
        const m_initialVector = guidToByteArray(method.initialVector).slice(0, 8); // only 1st 8 bytes

        // extend to 24 bytes (repeat 1st 8)
        const m_keyValue = Buffer.concat([m_keyValueBase, m_keyValueBase.slice(0, 8)]);

        const bytes = Buffer.from(data, 'binary');
        const cipher = crypto.createCipheriv('des-ede3-cbc', m_keyValue, m_initialVector);

        let encrypted = cipher.update(bytes);
        encrypted = Buffer.concat([encrypted, cipher.final()]);

        return encrypted.toString('base64');
    } catch(error) {
        return null;
    }
}

function decrypt(data, method) {
    if (data == null) return null;

    try {
        // guid to byte arr
        const m_keyValueBase = guidToByteArray(method.keyValue);
        const m_initialVector = guidToByteArray(method.initialVector).slice(0, 8); // only 1st 8 bytes

        // extend to 24 bytes (repeat 1st 8)
        const m_keyValue = Buffer.concat([m_keyValueBase, m_keyValueBase.slice(0, 8)]);

        const encBytes = Buffer.from(data, 'base64');
        const decipher = crypto.createDecipheriv('des-ede3-cbc', m_keyValue, m_initialVector);

        let decrypted = decipher.update(encBytes);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString('binary');
    } catch(error) {
        return null;
    }
}

module.exports = { encrypt, decrypt, encMethod };