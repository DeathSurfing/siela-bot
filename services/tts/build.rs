fn main() {
    let lib = pkg_config::Config::new()
        .atleast_version("1.49")
        .probe("espeak-ng")
        .expect("espeak-ng not found via pkg-config (install espeak-ng / libespeak-ng-dev)");
    for dir in &lib.link_paths {
        println!("cargo:rustc-link-search=native={}", dir.display());
    }
    for lib_name in &lib.libs {
        println!("cargo:rustc-link-lib={lib_name}");
    }
    println!("cargo:rerun-if-changed=build.rs");
}
