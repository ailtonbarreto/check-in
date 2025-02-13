document.addEventListener("DOMContentLoaded", function() {
    const inputFoto = document.getElementById("input-foto");
    const photo = document.getElementById("photo");


    function salvarFoto(event) {
        const arquivo = event.target.files[0]; 
        if (arquivo) {
  
            const leitorBase64 = new FileReader();

            leitorBase64.onload = function(e) {
                // Quando o arquivo for lido, obtém-se o resultado em base64
                const imagemBase64 = e.target.result;

                // Salva no sessionStorage em base64
                sessionStorage.setItem("foto_base64", imagemBase64);
            };

            // Lê o arquivo como uma URL de dados (base64)
            leitorBase64.readAsDataURL(arquivo);

            // Salvar a imagem em formato de arquivo normal
            const leitorNormal = new FileReader();

            leitorNormal.onload = function(e) {
                // Criar um Blob com os dados da imagem
                const imagemBlob = new Blob([e.target.result], { type: arquivo.type });

                // Criar uma URL para o arquivo normal
                const urlImagemNormal = URL.createObjectURL(imagemBlob);

                // Salva no sessionStorage a URL do arquivo normal
                sessionStorage.setItem("foto_normal", urlImagemNormal);
            };

            // Lê o arquivo como array buffer (para criar o Blob)
            leitorNormal.readAsArrayBuffer(arquivo);

            // Exibe a imagem em base64 na tela
            const imagemBase64 = leitorBase64.result;
            photo.src = imagemBase64;
            photo.style.display = "block"; // Torna a imagem visível
        }
    }

    // Adiciona o evento de mudança no input
    inputFoto.addEventListener("change", salvarFoto);
});
