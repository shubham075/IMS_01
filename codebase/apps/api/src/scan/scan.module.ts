import { Module } from "@nestjs/common";
import { StockModule } from "../stock/stock.module";
import { ScanController } from "./scan.controller";
import { ScanService } from "./scan.service";

@Module({ imports: [StockModule], controllers: [ScanController], providers: [ScanService] })
export class ScanModule {}
