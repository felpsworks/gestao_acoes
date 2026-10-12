// Indicador "Online" do cabeçalho: confere de tempos em tempos se o servidor
// responde. Bolinha verde piscando = sistema no ar; vermelha = sem conexão.
(() => {
  const INTERVALO_MS = 15000;
  const LIMITE_MS = 5000;
  const indicador = document.querySelector(".a8-online");
  if (!indicador) return;
  const texto = indicador.querySelector(".a8-online-texto");
  const url = indicador.dataset.ping;

  function mostrar(online) {
    indicador.classList.toggle("offline", !online);
    texto.textContent = online ? "Online" : "Offline";
    const agora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    indicador.title = online
      ? `Sistema no ar · última verificação às ${agora}`
      : `Sem conexão com o servidor · tentativa às ${agora}`;
  }

  async function verificar() {
    const controle = new AbortController();
    const espera = setTimeout(() => controle.abort(), LIMITE_MS);
    try {
      const resposta = await fetch(url, { cache: "no-store", signal: controle.signal });
      mostrar(resposta.ok);
    } catch {
      mostrar(false);
    } finally {
      clearTimeout(espera);
    }
  }

  verificar();
  setInterval(verificar, INTERVALO_MS);
  window.addEventListener("online", verificar);
  window.addEventListener("offline", () => mostrar(false));
})();
