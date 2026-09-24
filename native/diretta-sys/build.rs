use std::{env, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=DIRETTA_SDK_ROOT");
    println!("cargo:rerun-if-env-changed=DIRETTA_CPU_VARIANT");
    println!("cargo:rerun-if-changed=src/bridge.cpp");
    println!("cargo:rerun-if-changed=src/glibc_compat.c");

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
    let cpu_variant = env::var("DIRETTA_CPU_VARIANT")
        .ok()
        .filter(|value| matches!(value.as_str(), "v2" | "v3" | "v4"))
        .unwrap_or_else(|| {
            panic!("DIRETTA_CPU_VARIANT must be set to v2, v3, or v4");
        });

    let mut bridge = cc::Build::new();
    bridge
        .cpp(true)
        .std("c++20")
        .flag_if_supported("-fPIC")
        .include(&include_dir)
        .file("src/bridge.cpp");
    let libstdcxx_output = bridge
        .get_compiler()
        .to_command()
        .arg("-print-file-name=libstdc++.a")
        .output()
        .expect("failed to query the C++ compiler for libstdc++.a");
    if !libstdcxx_output.status.success() {
        panic!("the C++ compiler could not locate libstdc++.a");
    }
    let libstdcxx = PathBuf::from(
        String::from_utf8(libstdcxx_output.stdout)
            .expect("the C++ compiler returned a non-UTF-8 libstdc++.a path")
            .trim(),
    );
    if !libstdcxx.is_file() {
        panic!("the C++ compiler returned an invalid libstdc++.a path");
    }
    let libstdcxx_dir = libstdcxx
        .parent()
        .expect("libstdc++.a path does not have a parent directory");
    bridge.compile("atom_diretta_bridge");

    // glibc < 2.38 兼容层：ACQUA 预编译库引用了 C23 的 __isoc23_strtol/strtoll。
    // 在 glibc >= 2.38 平台上本文件条件编译为空，不会引入任何符号。
    cc::Build::new()
        .file("src/glibc_compat.c")
        .flag_if_supported("-fPIC")
        .compile("atom_glibc_compat");

    let (host_lib, acqua_lib): (String, String) = if target_arch == "aarch64" {
        (
            "DirettaHost_aarch64-linux-15-nolog".to_owned(),
            "ACQUA_aarch64-linux-15-nolog".to_owned(),
        )
    } else {
        (
            format!("DirettaHost_x64-linux-15{}-nolog", cpu_variant),
            format!("ACQUA_x64-linux-15{}-nolog", cpu_variant),
        )
    };

    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!("cargo:rustc-link-search=native={}", libstdcxx_dir.display());
    println!("cargo:rustc-link-lib=static={host_lib}");
    println!("cargo:rustc-link-lib=static={acqua_lib}");
    println!("cargo:rustc-link-lib=static=stdc++");
    println!("cargo:rustc-link-arg=-Wl,-Bsymbolic");
    println!("cargo:rustc-link-lib=dylib=pthread");
    println!("cargo:rustc-link-lib=dylib=dl");
    println!("cargo:rustc-link-lib=dylib=m");
    println!("cargo:rustc-link-lib=dylib=atomic");
}
