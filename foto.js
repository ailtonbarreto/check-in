document.addEventListener("DOMContentLoaded", function () {
    const inputFoto = document.getElementById("input-foto");
    const photo = document.getElementById("photo");

    function salvarFoto(event) {
        const arquivo = event.target.files[0];
        if (arquivo) {
            const leitorBase64 = new FileReader();

            leitorBase64.onload = function (e) {
                const imagemBase64 = e.target.result;
                sessionStorage.setItem("foto_base64", imagemBase64);
                photo.src = imagemBase64;
                photo.style.display = "block";
            };

            leitorBase64.readAsDataURL(arquivo);

            const leitorNormal = new FileReader();

            leitorNormal.onload = function (e) {
                const imagemBlob = new Blob([e.target.result], { type: arquivo.type });
                const urlImagemNormal = URL.createObjectURL(imagemBlob);
                sessionStorage.setItem("foto_normal", urlImagemNormal);
            };

            leitorNormal.readAsArrayBuffer(arquivo);
        }
    }

    inputFoto.addEventListener("change", salvarFoto);
});
