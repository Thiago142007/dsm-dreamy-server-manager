// Ponto de entrada do binário: todo o código vive na biblioteca `dsm_lib`,
// que é o formato padrão de um app Tauri v2 (permitindo testes e benches).
use std::fs;

fn main() {
    configurar_renderizacao();
    dsm_lib::run();
}

/// Ajusta a renderização antes do GTK inicializar.
///
/// Em algumas máquinas Linux o usuário não pertence ao grupo `render`, e aí o
/// WebKit não consegue abrir `/dev/dri/renderD128`:
///
/// ```text
/// libEGL warning: failed to open /dev/dri/renderD128: Permission denied
/// ```
///
/// O sintoma é a janela abrir e o conteúdo nunca aparecer (o WebKit fica
/// tentando usar a GPU). Quando detectamos esse caso, forçamos a renderização
/// por software — o app continua funcionando, só perde um pouco deperformance
/// em animações. Em máquinas com GPU acessível nada muda.
///
/// A correção permanente é o usuário entrar no grupo e renovar a sessão:
///
/// ```text
/// sudo usermod -aG render $USER   # depois sair e entrar de novo
/// ```
fn configurar_renderizacao() {
    if !gpu_acessivel() {
        std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

/// True quando conseguimos abrir um nó de renderização da GPU.
fn gpu_acessivel() -> bool {
    let nos = ["/dev/dri/renderD128", "/dev/dri/card0"];
    nos.iter().any(|caminho| fs::File::open(caminho).is_ok())
}
