import fs from 'fs'
import {getCorePath} from "@/main/app";
import path from "path";
import child_process from "child_process";
import is from "electron-is";
import {SoftwareInstallStatus} from "@/main/enum";
import extract from "extract-zip";
import {getTypePath} from "@/main/software/software";
import {getDownloadsPath} from "@/main/path";


export default class Installer {
    softItem;
    constructor(softItem) {
        this.softItem = softItem;
        this.softItem.installInfo = this.softItem.installInfo ? this.softItem.installInfo : {}
        this.softItem.installInfo.status = SoftwareInstallStatus.Ready;
        this.resetDownloadInfo();
        this.downloadSignal =  this.softItem.downloadAbortController?.signal;
        this.softItem.url = 'https://dl-cdn.phpenv.cn/release/test.zip';
    }

    resetDownloadInfo(){
        this.softItem.installInfo.dlInfo = {
            completedSize: 0,
            totalSize: 0,
            percent: 0,
            perSecond: '0KB',
        }
    }

    setDownloadInfo(dlInfo) {
        this.softItem.installInfo.dlInfo = {
            completedSize: dlInfo.completedSize,
            totalSize: dlInfo.totalSize,
            percent: dlInfo.percent,
            perSecond: dlInfo.perSecond,
        }
    }

    async install(){
        console.log( 'this.softItem',this.softItem)
        this.resetDownloadInfo();
        try{
            this.changeStatus(SoftwareInstallStatus.Downloading);
            await this.download();
        }catch (error) {
            this.changeStatus(SoftwareInstallStatus.DownloadError);
            throw new Error(`下载失败，${error.message}`);
        }

        if (is.dev()) console.log('判断是否下载完成')

        if(this.status !== SoftwareInstallStatus.Downloaded){
            this.changeStatus(SoftwareInstallStatus.Abort);
            return;
        }

        if (is.dev()) console.log('开始解压...')

        try{
            this.changeStatus(SoftwareInstallStatus.Extracting);
            await this.zipExtract();
            this.changeStatus(SoftwareInstallStatus.Extracted);
        }catch (error) {
            this.changeStatus(SoftwareInstallStatus.ExtractError);
            throw new Error(`解压失败，${error.message}`);
        }
        this.changeStatus(SoftwareInstallStatus.Finish);
    }

    async download() {
        return await new Promise((resolve, reject) => {
            let corePath = getCorePath();
            let downloaderPath = path.join(corePath, 'aria2c');
            let downloadsPath = path.join(corePath, 'downloads');
            let args = [this.softItem.url, '--check-certificate=false', `--dir=${downloadsPath}`];

            let dlProcess  = child_process.spawn(downloaderPath, args);
            const progressRegx = /([\d.]+\w+)\/([\d.]+\w+)\((\d+)%\).+DL:([\d.]+\w+)/;
            const errRegx = /errorCode=\d+.+/g;
            // 触发abort
            function abortDownload() {
                dlProcess.kill();
            }

            if (this.downloadSignal) {
                //当 abort() 被调用时，这个promise 不会 reject 一个名为 AbortError 的 DOMException
                this.downloadSignal.addEventListener('abort', abortDownload)
            }

            dlProcess.stdout.on('data', (data) => {
                data = data.toString();
                if (is.dev())  console.log(data)
                let matches = data.match(progressRegx)
                if (matches) {
                    this.setDownloadInfo({
                        completedSize: matches[1].replace('i', ''),
                        totalSize: matches[2].replace('i', ''),
                        percent: parseFloat(matches[3]),
                        perSecond: matches[4].replace('i', ''),
                    })
                } else {
                    let errMatches = data.match(errRegx)
                    if (errMatches && errMatches.length > 0) {
                        this.errMsg = errMatches.pop();
                    }
                }
            });

            dlProcess.on('close', (code) => {
                if (this.downloadSignal) {
                    this.downloadSignal.removeEventListener('abort', abortDownload);
                }
                if (code == null) {
                    this.changeStatus(SoftwareInstallStatus.Abort);
                    return resolve(true);
                }
                if (code === 0) {
                    this.changeStatus(SoftwareInstallStatus.Downloaded);
                    return resolve(true);
                }
                reject(new Error(this.errMsg));
            });

        });

    }

    changeStatus(status){
        this.softItem.installInfo.status = status;
    }


    async zipExtract() {
        let softItem = this.softItem;
        softItem.DirName = 'test';
        let filePath = path.join(getDownloadsPath(), `HandyControl.git.zip`);
        let typePath = getTypePath(softItem.Type)
        console.log('filePath',filePath)
        console.log('typePath',typePath)
        return await extract(filePath, {dir: typePath});
    }



    /**
     *
     * @param status SoftwareInstallStatus
     */
    getStatusText(status) {
        switch (status) {
            case SoftwareInstallStatus.Downloading:
                return '下载中';
            case SoftwareInstallStatus.Extracting:
                return '解压中';
            case SoftwareInstallStatus.Finish:
                return '安装完成';
            default:
                return '';
        }
    }

    static getList(type) {
        let corePath = getCorePath();
        let softPath = path.join(corePath, '/config/software');
        let softConfigPath = path.join(softPath, 'software.json');
        let softIconPath = path.join(softPath, '/icon');
        let json = fs.readFileSync(softConfigPath);
        let list = JSON.parse(json);

        let newList =  [];
        for (const item of list) {
            if (type && type !== item.Type) {
                continue;
            }
            let newItem = item;
            newItem.Icon = path.join(softIconPath, item.Icon);
            newList.push(newItem);
        }
        return newList;
    }


}
