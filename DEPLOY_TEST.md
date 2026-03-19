# Loop Manager Test — Deploy Instructions

## Passo 1: Criar repo no GitHub
1. Vá em github.com/new
2. Nome: `loop-manager-test`
3. Público ou privado (sua escolha)
4. NÃO inicialize com README

## Passo 2: Upload do código
Opção A (Upload direto no GitHub):
1. No repo vazio, clique "uploading an existing file"
2. Extraia o ZIP e arraste TODOS os arquivos/pastas
3. Commit

Opção B (Git CLI):
```bash
cd loop-manager-test
git init
git add .
git commit -m "Loop Manager + Radar v2.0"
git remote add origin https://github.com/rvsaadi/loop-manager-test.git
git push -u origin main
```

## Passo 3: Conectar ao Netlify
O site `loop-manager-test` já foi criado no Netlify com a API key configurada.
1. Vá em https://app.netlify.com/projects/loop-manager-test
2. Clique "Link repository" 
3. Conecte ao GitHub repo `loop-manager-test`
4. Build command: `npm run build`
5. Publish directory: `dist`
6. Deploy!

## Passo 4: Testar
URL: https://loop-manager-test.netlify.app
- Clique na aba 📡 Radar
- Teste "Varredura H1" 
- Teste input manual: digite "Lip Tint Coreano" e clique Analisar
- Teste bridge: clique "🤖 Avaliar com AI" num candidato
