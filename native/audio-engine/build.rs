use std::{env, path::PathBuf};

fn configure_diretta() {
    println!("cargo:rustc-check-cfg=cfg(atom_diretta)");
    println!("cargo:rerun-if-env-changed=DIRETTA_SDK_ROOT");
    println!("cargo:rerun-if-changed=diretta/bridge.cpp");

    let Ok(root) = env::var("DIRETTA_SDK_ROOT") else {
        return;
    };
    if root.trim().is_empty() {
        return;
    }

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    if target_os != "linux" || !matches!(target_arch.as_str(), "x86_64" | "aarch64") {
        panic!("Diretta SDK build currently supports Linux x86_64/aarch64 only");
    }

    let root = PathBuf::from(root);
    let include_dir = root.join("Host");
    let lib_dir = root.join("lib");
    if !include_dir.is_dir() || !lib_dir.is_dir() {
        panic!("DIRETTA_SDK_ROOT must contain Host/ and lib/");
    }

    cc::Build::new()
        .cpp(true)
        .std("c++20")
        .flag_if_supported("-fPIC")
        .include(&include_dir)
        .file("diretta/bridge.cpp")
        .compile("atom_diretta_bridge");

    let (host_lib, acqua_lib) = if target_arch == "aarch64" {
        (
            "DirettaHost_aarch64-linux-15-nolog",
            "ACQUA_aarch64-linux-15-nolog",
        )
    } else {
        (
            "DirettaHost_x64-linux-15v2-nolog",
            "ACQUA_x64-linux-15v2-nolog",
        )
    };

    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!("cargo:rustc-link-lib=static={host_lib}");
    println!("cargo:rustc-link-lib=static={acqua_lib}");
    // Diretta Linux SDK 的静态库不是 PIC；将 libstdc++ 同样静态绑定到最终 DSO，
    // 再用 -Bsymbolic 让 SDK 内的 PC-relative C++ vtable 引用解析到本 DSO 内部。
    println!("cargo:rustc-link-lib=static=stdc++");
    println!("cargo:rustc-link-arg=-Wl,-Bsymbolic");
    println!("cargo:rustc-link-lib=dylib=pthread");
    println!("cargo:rustc-link-lib=dylib=dl");
    println!("cargo:rustc-link-lib=dylib=m");
    println!("cargo:rustc-link-lib=dylib=atomic");
    println!("cargo:rustc-cfg=atom_diretta");
}

fn main() {
    napi_build::setup();
    configure_diretta();

    #[cfg(target_os = "windows")]
    {
        println!("cargo:rustc-link-lib=strmiids");
        println!("cargo:rustc-link-lib=ole32");
        println!("cargo:rustc-link-lib=oleaut32");
        println!("cargo:rustc-link-lib=user32");
        println!("cargo:rustc-link-lib=gdi32");
        println!("cargo:rustc-link-lib=vfw32");
        println!("cargo:rustc-link-lib=bcrypt");
        println!("cargo:rustc-link-lib=secur32");
        println!("cargo:rustc-link-lib=ws2_32");
        println!("cargo:rustc-link-lib=mfplat");
        println!("cargo:rustc-link-lib=mfreadwrite");
        println!("cargo:rustc-link-lib=mfuuid");
    }
}
