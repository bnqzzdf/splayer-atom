use std::{env, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=DIRETTA_SDK_ROOT");
    println!("cargo:rerun-if-changed=src/bridge.cpp");

    if env::var_os("CARGO_FEATURE_SDK").is_none() {
        return;
    }

    let root = env::var("DIRETTA_SDK_ROOT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .expect("diretta-sys is enabled but DIRETTA_SDK_ROOT is not set");
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    if target_os != "linux" || !matches!(target_arch.as_str(), "x86_64" | "aarch64") {
        panic!("Diretta SDK build supports Linux x86_64/aarch64 only");
    }

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
        .file("src/bridge.cpp")
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
    println!("cargo:rustc-link-lib=static=stdc++");
    println!("cargo:rustc-link-arg=-Wl,-Bsymbolic");
    println!("cargo:rustc-link-lib=dylib=pthread");
    println!("cargo:rustc-link-lib=dylib=dl");
    println!("cargo:rustc-link-lib=dylib=m");
    println!("cargo:rustc-link-lib=dylib=atomic");
}
