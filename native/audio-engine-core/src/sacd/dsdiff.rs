//! 流式写出 SACD DSDIFF，DST 帧保持压缩字节，不解码。

use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

use anyhow::{ensure, Context, Result};

use super::scarletbook::SACD_FRAME_RATE;

const DSDIFF_VERSION: u32 = 0x0105_0000;

fn write_tag(buffer: &mut Vec<u8>, tag: &[u8; 4]) {
    buffer.extend_from_slice(tag);
}

fn write_chunk(buffer: &mut Vec<u8>, tag: &[u8; 4], body: &[u8]) {
    write_tag(buffer, tag);
    buffer.extend_from_slice(&(body.len() as u64).to_be_bytes());
    buffer.extend_from_slice(body);
    if body.len() % 2 == 1 {
        buffer.push(0);
    }
}

pub struct DsdiffWriter {
    file: File,
    is_dst: bool,
    header_len: u64,
    payload_size_offset: u64,
    payload_body_len: u64,
}

impl DsdiffWriter {
    pub fn create(path: &Path, sample_rate: u32, channels: u16, is_dst: bool) -> Result<Self> {
        ensure!(sample_rate > 0, "DSDIFF sample rate 无效");
        ensure!(channels == 2, "SACD DSDIFF 仅支持双声道");

        let mut header = Vec::with_capacity(160);
        write_tag(&mut header, b"FRM8");
        header.extend_from_slice(&0_u64.to_be_bytes());
        write_tag(&mut header, b"DSD ");

        let mut fver_body = Vec::with_capacity(4);
        fver_body.extend_from_slice(&DSDIFF_VERSION.to_be_bytes());
        write_chunk(&mut header, b"FVER", &fver_body);

        let mut prop_body = Vec::with_capacity(64);
        write_tag(&mut prop_body, b"SND ");

        let mut fs_body = Vec::with_capacity(4);
        fs_body.extend_from_slice(&sample_rate.to_be_bytes());
        write_chunk(&mut prop_body, b"FS  ", &fs_body);

        let mut chnl_body = Vec::with_capacity(10);
        chnl_body.extend_from_slice(&channels.to_be_bytes());
        chnl_body.extend_from_slice(b"SLFT");
        chnl_body.extend_from_slice(b"SRGT");
        write_chunk(&mut prop_body, b"CHNL", &chnl_body);

        let mut cmpr_body = Vec::with_capacity(8);
        if is_dst {
            write_tag(&mut cmpr_body, b"DST ");
            cmpr_body.push(3);
            cmpr_body.extend_from_slice(b"DST");
        } else {
            write_tag(&mut cmpr_body, b"DSD ");
            cmpr_body.push(3);
            cmpr_body.extend_from_slice(b"DSD");
        }
        write_chunk(&mut prop_body, b"CMPR", &cmpr_body);
        write_chunk(&mut header, b"PROP", &prop_body);

        write_tag(&mut header, if is_dst { b"DST " } else { b"DSD " });
        header.extend_from_slice(&0_u64.to_be_bytes());

        let mut file =
            File::create(path).with_context(|| format!("创建 DSDIFF 失败: {}", path.display()))?;
        file.write_all(&header)
            .with_context(|| format!("写入 DSDIFF 头失败: {}", path.display()))?;
        let header_len = header.len() as u64;
        Ok(Self {
            file,
            is_dst,
            header_len,
            payload_size_offset: header_len - 8,
            payload_body_len: 0,
        })
    }

    pub fn write_frame(&mut self, frame: &[u8]) -> Result<()> {
        ensure!(!frame.is_empty(), "DSDIFF 帧为空");
        if self.is_dst {
            self.file.write_all(b"DSTF")?;
            self.file.write_all(&(frame.len() as u64).to_be_bytes())?;
            self.file.write_all(frame)?;
            let padding = frame.len() % 2;
            if padding == 1 {
                self.file.write_all(&[0])?;
            }
            self.payload_body_len += (12 + frame.len() + padding) as u64;
        } else {
            self.file.write_all(frame)?;
            self.payload_body_len += frame.len() as u64;
        }
        Ok(())
    }

    pub fn finish(mut self, frame_count: u32) -> Result<()> {
        if self.is_dst {
            let mut frte = Vec::with_capacity(18);
            write_tag(&mut frte, b"FRTE");
            frte.extend_from_slice(&6_u64.to_be_bytes());
            frte.extend_from_slice(&frame_count.to_be_bytes());
            frte.extend_from_slice(&(SACD_FRAME_RATE as u16).to_be_bytes());
            self.file.write_all(&frte)?;
            self.payload_body_len += frte.len() as u64;
        }

        let form_size = (self.header_len - 12) + self.payload_body_len;
        self.file.seek(SeekFrom::Start(4))?;
        self.file.write_all(&form_size.to_be_bytes())?;
        self.file.seek(SeekFrom::Start(self.payload_size_offset))?;
        self.file.write_all(&self.payload_body_len.to_be_bytes())?;
        self.file.flush()?;
        Ok(())
    }
}
