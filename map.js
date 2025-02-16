function plotarPessoasNoMapa() {
    // Fazer a requisição GET à API para buscar as informações das pessoas
    fetch("https://sua-api.com/pessoas")  // Substitua pela URL correta da sua API
        .then(response => response.json())
        .then(pessoas => {
            // Verifique se o mapa já foi inicializado, caso contrário, inicialize
            if (!map) {
                // Inicialize o mapa com as coordenadas da primeira pessoa (ou uma coordenada padrão)
                map = L.map('map').setView([pessoas[0].lat, pessoas[0].lon], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
            }

            // Adicionar marcadores para todas as pessoas recebidas
            pessoas.forEach(pessoa => {
                // Adiciona um marcador para cada pessoa
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

// Chame a função para plotar as pessoas no mapa
plotarPessoasNoMapa();
