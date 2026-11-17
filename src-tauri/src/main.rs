// En release no mostramos una consola adicional en Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    git_leviathan_lib::run();
}
