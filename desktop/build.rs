use flate2::{write::GzEncoder, Compression};
use std::{fs, io::Write, path::Path};

fn main() {
    if std::env::var_os("CARGO_CFG_WINDOWS").is_some() {
        let _ = embed_resource::compile("mihonban.rc", embed_resource::NONE);
    }

    let output = std::env::var_os("OUT_DIR").expect("Cargo sets OUT_DIR");
    let fonts = [
        "Inter-Regular",
        "Inter-SemiBold",
        "ShipporiMincho-SemiBold",
        "ShipporiMincho-Bold",
        "NotoSansSC-Regular",
        "NotoSerifSC-SemiBold",
        "NotoSansKR-Regular",
        "NotoSerifKR-SemiBold",
    ];
    for name in fonts {
        let source = Path::new("assets").join(format!("{name}.ttf"));
        println!("cargo:rerun-if-changed={}", source.display());
        let bytes = fs::read(&source).expect("bundled font is readable");
        let destination = Path::new(&output).join(format!("{name}.ttf.gz"));
        let file = fs::File::create(destination).expect("compressed font can be created");
        let mut encoder = GzEncoder::new(file, Compression::best());
        encoder.write_all(&bytes).expect("font can be compressed");
        encoder.finish().expect("compressed font can be finalized");
    }
}
