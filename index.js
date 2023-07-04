import {mkdirSync, writeFileSync, rmSync, readFileSync} from 'fs';
import * as path from 'path';
import {promisify} from 'util';
import * as childProcess from 'child_process';
import axios from 'axios';
import {Agent} from 'https';
import {platform} from 'os';

const agent = new Agent({
    ciphers: ['TLS_CHACHA20_POLY1305_SHA256', 'TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384', 'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256'].join(':'),
    honorCipherOrder: true,
    minVersion: 'TLSv1.2',
});

const exec = promisify(childProcess.exec);
const execFile = promisify(childProcess.execFile);

const base_path = 'files';
const versioning_dir = path.join(base_path, 'valorant');
const temp_dir = path.join(base_path, 'temp');

const task_timeout = 30 * 60;
const refresh_timeout = 5 * 60;

async function getValorantVersion(exeFilePath) {
    const exe_file_data = readFileSync(exeFilePath);
    const pattern = Buffer.from('++Ares-Core+', 'utf16le');
    const pos = exe_file_data.indexOf(pattern) + pattern.length;

    const [branch, build_date, build_ver, version] = exe_file_data
        .slice(pos, pos + 96)
        .toString('utf16le')
        .split('\x00')
        .filter(Boolean);

    return {
        branch,
        build_date,
        build_ver,
        version,
        last_checked: new Date().toISOString(),
        version_for_api: `${branch}-shipping-${build_ver}-${version.split('.').pop().replace(/^0+/, '')}`,
    };
}

const checkUpdateForRegion = async regionData => {
    const {
        patch_url,
        valid_shards: {live},
    } = regionData;
    const region = String(live[0]);
    try {
        if (platform() == 'win32')
            await exec(
                `ManifestDownloader.exe ${patch_url} -b "https://valorant.secure.dyn.riotcdn.net/channels/public/bundles" -f "ShooterGame/Binaries/Win64/VALORANT-Win64-Shipping.exe" -o ${temp_dir} -t 4`,
                {cwd: process.cwd(), timeout: 60000}
            );
        else if (platform() == 'linux') {
            const linux_base_folder = '/home/debian/ManifestDownloader';
            await execFile(
                linux_base_folder,
                [
                    patch_url,
                    '-b',
                    'https://valorant.secure.dyn.riotcdn.net/channels/public/bundles',
                    '-f',
                    'ShooterGame/Binaries/Win64/VALORANT-Win64-Shipping.exe',
                    `-o`,
                    temp_dir,
                    '-t',
                    '4',
                ],
                {cwd: process.cwd(), timeout: 60000}
            );
        }
    } catch (err) {
        console.error(err);
        return;
    }

    const versionData = await getValorantVersion(path.join(temp_dir, 'ShooterGame/Binaries/Win64/VALORANT-Win64-Shipping.exe'));
    writeFileSync(path.join(versioning_dir, `${region}.json`), JSON.stringify({...versionData, patch_url, region}));
};

async function main() {
    mkdirSync(temp_dir, {recursive: true});
    mkdirSync(versioning_dir, {recursive: true});

    try {
        const valorantRelease = await axios.get('https://clientconfig.rpg.riotgames.com/api/v1/config/public?namespace=keystone.products.valorant.patchlines', {
            timeout: 1000,
            httpsAgent: agent,
        });
        const configurations = valorantRelease.data['keystone.products.valorant.patchlines.live'].platforms.win.configurations;

        for (const configuration of configurations) {
            await checkUpdateForRegion(configuration);
        }
    } catch (err) {
        console.error(err);
    }

    rmSync(temp_dir, {recursive: true});
    console.log(`Last checked on: ${new Date().toLocaleString()}`);

    await new Promise(resolve => setTimeout(resolve, task_timeout * 1000));
}

main().catch(console.error);
