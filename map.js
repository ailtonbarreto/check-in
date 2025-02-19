let map;

document.addEventListener("DOMContentLoaded", function () {

  sessionStorage.clear()

  const spinner = document.getElementById("spinner");

  function plotarPessoasNoMapa() {

    if (spinner) spinner.style.display = "block";

    // fetch("https://api-localizacao-e69z.onrender.com/localizacoes")
    fetch("http://srv729870.hstgr.cloud:3000/localizacoes")

      .then(response => response.json())
      .then(response => {

        const pessoas = response.data;
        if (!map) {

          map = L.map("map").setView([pessoas[0].lat, pessoas[0].lon], 2.5);
          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
        }

        pessoas.forEach(pessoa => {

          const imagem = pessoa.foto.startsWith('data:image') ? pessoa.foto : `data:image/jpeg;base64,${pessoa.foto}`;

          L.marker([pessoa.lat, pessoa.lon]).addTo(map)
            .bindPopup(`
              <strong>${pessoa.pessoa}</strong><br>
              <img src="${imagem}" alt="${pessoa.pessoa}" width="100"><br>
            `);
        });
      })
      .catch(error => {
        console.error("Erro ao buscar dados da API:", error);
        alert("Houve um erro ao carregar as informações.");
      })
      .finally(() => {
        if (spinner) spinner.style.display = "none";
      });
  }

  plotarPessoasNoMapa();
});
