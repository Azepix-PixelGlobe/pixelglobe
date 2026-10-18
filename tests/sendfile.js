import fs from 'fs';
import path from 'path';
import { Readable, Transform } from 'stream';

async function sendFile() {
  const filename = 'test.webm';
  const mimetype = 'video/webm';
  // const filename = 'test.png';
  // const mimetype = 'image/png';

  const filePath = path.join(process.cwd(), filename);
  const fileBuffer = fs.readFileSync(filePath);

  const WITH_FORM_DATA = true;
  let response;

  if (WITH_FORM_DATA) {

    const formData = new FormData();

    // Read the file and create a File object
    const file = new File([fileBuffer], filename, { type: mimetype });

    // Append the file with fieldname 'file'
    // formData.append('hash', 'a07a744a7c8570d215ce13a2eb25779c09ca44b73c7f15e83266f1da990ac5e5');
    formData.append('file', file);

    // Send POST request using native fetch
    response = await fetch('http://[::1]:33333/upload', {
      method: 'POST',
      body: formData,
    })

  } else {

    const boundary = `----FormDataBoundary${Math.random().toString(36)}`;
    let bytesSent = 0;

    const hashField = `--${boundary}\r\nContent-Disposition: form-data; name="hash"\r\n\r\na07a744a7c8570d215ce13a2eb25779c09ca44b73c7f15e83266f1da990ac5e5\r\n`;
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const chunks = [
      Buffer.from(hashField, 'utf8'),
      Buffer.from(header, 'utf8'),
    ]
    const chunkSize = 4 * 1024; // 4KB chunks
    for (let i = 0; i < fileBuffer.length; i += chunkSize) {
      chunks.push(fileBuffer.slice(i, i + chunkSize));
    }
    chunks.push(Buffer.from(footer, 'utf8'));
    const stream = Readable.from(chunks);

    const targetBytesPerSecond = 1024 * 512;

    // Create a transform stream to track progress
    const progressStream = new Transform({
      transform(chunk, encoding, callback) {
        bytesSent += chunk.length;
        console.log(`Bytes sent: ${bytesSent}`);
        const delay = (chunk.length / targetBytesPerSecond) * 1000;
        console.log('waiting', delay / 1000);
        setTimeout(() => {
          callback(null, chunk);
        }, delay);
      }
    });

    response = await fetch('http://[::1]:33333/upload', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: stream.pipe(progressStream),
      duplex: 'half',
    });
  }

  if (!response.ok) {
    console.log(`HTTP error! status: ${response.status}\n${await response.text()}`);
    return;
  }

  console.log('File uploaded successfully!');
  console.log('Status:', response.status);
  console.log('Response:', await response.text());
}

sendFile();
