function plotarPessoasNoMapa() {

    fetch("https://api-localizacao-e69z.onrender.com/localizacoes")
        .then(response => response.json())
        .then(pessoas => {
  
            if (!map) {
   
                map = L.map('map').setView([pessoas[0].lat, pessoas[0].lon], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
            }


            pessoas.forEach(pessoa => {
           
                L.marker([pessoa.lat, pessoa.lon]).addTo(map)
                    .bindPopup(`
                        <strong>${pessoa.nome}</strong><br>
                        <img src="${pessoa.foto}" alt="${pessoa.nome}" width="100"><br>
                        Latitude: ${pessoa.lat}<br>
                        Longitude: ${pessoa.lon}
                    `)
                    .openPopup();
            });
        })
        .catch(error => {
            console.error("Erro ao buscar dados da API:", error);
            alert("Houve um erro ao carregar as informações.");
        });
}

plotarPessoasNoMapa();
