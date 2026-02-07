let map;

document.addEventListener("DOMContentLoaded", () => {

  sessionStorage.clear();

  const spinner = document.getElementById("spinner");
  const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTI07zWyCW42reug--h1Kv6Mo9xsxIKjxQGzJCl0jP7CTD2UGXLIQkxQwZa_YtfiSZziQOS8cdM-H4K/pub?gid=0&single=true&output=csv";

  function csvParaObjeto(csv) {
    const linhas = csv.trim().split("\n");
    const cabecalho = linhas.shift().split(",");

    return linhas.map(linha => {
      const valores = linha.split(",");
      const obj = {};

      cabecalho.forEach((coluna, index) => {
        obj[coluna.trim()] = valores[index]?.trim();
      });

      return obj;
    });
  }

  function plotarPessoasNoMapa() {

    if (spinner) spinner.style.display = "block";

    fetch(CSV_URL)
      .then(response => response.text())
      .then(csv => {

        const pessoas = csvParaObjeto(csv);

        if (!pessoas.length) {
          alert("Nenhum dado encontrado na planilha.");
          return;
        }

        if (!map) {
          map = L.map("map").setView(
            [Number(pessoas[0].lat), Number(pessoas[0].lon)],
            2.5
          );

          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap"
          }).addTo(map);
        }

        pessoas.forEach(pessoa => {

          if (!pessoa.lat || !pessoa.lon) return;

          let imagem = "";

          if (pessoa.foto) {
            imagem = pessoa.foto.startsWith("data:image")
              ? pessoa.foto
              : `data:image/jpeg;base64,${pessoa.foto}`;
          }

          L.marker([Number(pessoa.lat), Number(pessoa.lon)])
            .addTo(map)
            .bindPopup(`
              <strong>${pessoa.pessoa}</strong><br>
              ${imagem ? `<img src="${imagem}" width="100">` : ""}
            `);
        });
      })
      .catch(err => {
        console.error("Erro ao ler CSV:", err);
        alert("Erro ao carregar dados da planilha.");
      })
      .finally(() => {
        if (spinner) spinner.style.display = "none";
      });
  }

  plotarPessoasNoMapa();
});
