let map;

function mostrarLocalizacao() {

    document.getElementById("spinner").style.display = "block";
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(iniciarMapa, mostrarErro);
    } else {
        alert("Geolocalização não é suportada por este navegador.");
    }
}

function iniciarMapa(posicao) {
    let latitude = posicao.coords.latitude;
    let longitude = posicao.coords.longitude;

    if (!map) {
        map = L.map('map').setView([latitude, longitude], 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
    } else {

        map.setView([latitude, longitude], 13);
    }


    L.marker([latitude, longitude]).addTo(map)
        .bindPopup("<b>Você está aqui!</b>")
        .openPopup();


    document.getElementById("spinner").style.display = "none";
}

function mostrarErro(erro) {
    switch(erro.code) {
        case erro.PERMISSION_DENIED:
            alert("Usuário negou a solicitação de geolocalização.");
            break;
        case erro.POSITION_UNAVAILABLE:
            alert("Informações de localização indisponíveis.");
            break;
        case erro.TIMEOUT:
            alert("A solicitação de geolocalização excedeu o tempo limite.");
            break;
        case erro.UNKNOWN_ERROR:
            alert("Erro desconhecido.");
            break;
    }

    document.getElementById("spinner").style.display = "none";
}
