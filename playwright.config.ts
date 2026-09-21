import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',workers:1,fullyParallel:false,forbidOnly:true,retries:0,timeout:60000,expect:{timeout:12000},outputDir:'.runtime/ui-results',reporter:'list',use:{baseURL:'http://127.0.0.1:5175',viewport:{width:1440,height:1000},screenshot:'only-on-failure'},webServer:[
 {command:'node --env-file=.runtime/test.env --import tsx scripts/ui-test-server.ts',url:'http://127.0.0.1:8792/ready',reuseExistingServer:false,timeout:20000},
 {command:'npm run dev:web',url:'http://127.0.0.1:5175',env:{VITE_DEV_API_TARGET:'http://127.0.0.1:8792'},reuseExistingServer:false,timeout:20000},
 {command:'npm exec -w @za-spa/client -- vite preview --config vite.web.config.ts --outDir ../../out/renderer --host 127.0.0.1 --port 5177 --strictPort',url:'http://127.0.0.1:5177',env:{VITE_DEV_API_TARGET:'http://127.0.0.1:8792'},reuseExistingServer:false,timeout:20000}
]});
